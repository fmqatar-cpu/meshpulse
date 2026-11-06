package com.meshpulse.app

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.Build
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.URL
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit

class AndroidBridge(private val context: Context) {

    private val executor = Executors.newCachedThreadPool()
    private val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
    private val connManager = context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager

    @JavascriptInterface
    fun isAndroid(): Boolean = true

    @JavascriptInterface
    fun triggerScan(): Boolean {
        return try {
            wifiManager?.startScan() ?: false
        } catch (e: Exception) {
            false
        }
    }

    @JavascriptInterface
    fun getWifiInfo(): String {
        val result = JSONObject()
        try {
            val info = wifiManager?.connectionInfo
            val dhcp = wifiManager?.dhcpInfo

            // Try getting current Wi-Fi from NetworkCapabilities if available (Android 10+)
            var activeBssid = info?.bssid ?: ""
            var activeSsid = info?.ssid ?: ""

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && connManager != null) {
                val activeNetwork = connManager.activeNetwork
                val caps = connManager.getNetworkCapabilities(activeNetwork)
                if (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                    val wifiInfoObj = caps.transportInfo as? android.net.wifi.WifiInfo
                    if (wifiInfoObj != null) {
                        if (wifiInfoObj.bssid != null && wifiInfoObj.bssid != "02:00:00:00:00:00") {
                            activeBssid = wifiInfoObj.bssid
                        }
                        if (wifiInfoObj.ssid != null && wifiInfoObj.ssid != "<unknown ssid>") {
                            activeSsid = wifiInfoObj.ssid
                        }
                    }
                }
            }

            if ((info != null && info.networkId != -1) || activeBssid.isNotEmpty()) {
                var ssid = if (activeSsid.isNotEmpty()) activeSsid else (info?.ssid ?: "")
                if (ssid.startsWith("\"") && ssid.endsWith("\"")) {
                    ssid = ssid.substring(1, ssid.length - 1)
                }

                var bssid = if (activeBssid.isNotEmpty()) activeBssid else (info?.bssid ?: "")
                if (bssid == "02:00:00:00:00:00") {
                    bssid = ""
                }

                // If BSSID was redacted by Android, resolve candidate from scan results
                if (bssid.isEmpty() && ssid.isNotEmpty()) {
                    try {
                        val scans = wifiManager?.scanResults ?: emptyList()
                        val matchingScans = scans.filter {
                            val scanSsid = it.SSID ?: ""
                            scanSsid == ssid || scanSsid == "\"$ssid\""
                        }.sortedByDescending { it.level }

                        if (matchingScans.isNotEmpty()) {
                            bssid = matchingScans[0].BSSID ?: ""
                        }
                    } catch (e: Exception) {
                        // Scan results restricted
                    }
                }

                val rssi = info?.rssi ?: -50
                val freq = info?.frequency ?: 5180
                val band = when {
                    freq in 2400..2500 -> "2.4 GHz"
                    freq in 4900..5900 -> "5 GHz"
                    freq in 5925..7125 -> "6 GHz"
                    else -> "Wi-Fi"
                }

                // Calculate signal percentage (0 to 100)
                val signalPercent = WifiManager.calculateSignalLevel(rssi, 101)

                val gatewayIp = if (dhcp != null && dhcp.gateway != 0) {
                    formatIp(dhcp.gateway)
                } else {
                    "192.168.1.1"
                }

                val localIp = if (dhcp != null && dhcp.ipAddress != 0) {
                    formatIp(dhcp.ipAddress)
                } else {
                    "Local Device"
                }

                val linkSpeed = info?.linkSpeed ?: 433

                result.put("connected", true)
                result.put("ssid", ssid)
                result.put("bssid", bssid.lowercase())
                result.put("rssi", rssi)
                result.put("signal", signalPercent)
                result.put("frequency", freq)
                result.put("band", band)
                result.put("txRate", linkSpeed)
                result.put("rxRate", linkSpeed)
                result.put("gatewayIp", gatewayIp)
                result.put("localIp", localIp)
            } else {
                result.put("connected", false)
            }
        } catch (e: Exception) {
            result.put("connected", false)
            result.put("error", e.message)
        }
        return result.toString()
    }

    @JavascriptInterface
    fun ping(host: String, timeoutSec: Int): String {
        val result = JSONObject()
        val future = executor.submit<String> {
            try {
                val start = System.currentTimeMillis()
                val process = Runtime.getRuntime().exec("/system/bin/ping -c 1 -W $timeoutSec $host")
                val reader = BufferedReader(InputStreamReader(process.inputStream))
                val output = StringBuilder()
                var line: String?
                while (reader.readLine().also { line = it } != null) {
                    output.append(line).append("\n")
                }
                val exitCode = process.waitFor()
                val end = System.currentTimeMillis()

                val text = output.toString()
                val inner = JSONObject()
                if (exitCode == 0) {
                    val match = Regex("time=([0-9.]+)").find(text)
                    val latency = match?.groupValues?.get(1)?.toDoubleOrNull() ?: (end - start).toDouble()
                    inner.put("success", true)
                    inner.put("latency", latency)
                } else {
                    inner.put("success", false)
                    inner.put("latency", null)
                }
                inner.toString()
            } catch (e: Exception) {
                val err = JSONObject()
                err.put("success", false)
                err.put("error", e.message ?: "Ping execution error")
                err.toString()
            }
        }
        return try {
            future.get((timeoutSec * 1000L) + 1500L, java.util.concurrent.TimeUnit.MILLISECONDS)
        } catch (e: Exception) {
            result.put("success", false)
            result.put("error", e.message ?: "Timeout")
            result.toString()
        }
    }

    @JavascriptInterface
    fun fetchHttp(urlStr: String, timeoutMs: Int): String {
        val result = JSONObject()
        val future = executor.submit<String> {
            try {
                val url = URL(urlStr)
                val conn = url.openConnection() as HttpURLConnection
                conn.connectTimeout = timeoutMs
                conn.readTimeout = timeoutMs
                conn.requestMethod = "GET"
                conn.setRequestProperty("Accept", "application/json")

                val code = conn.responseCode
                val stream = if (code in 200..299) conn.inputStream else conn.errorStream
                val content = if (stream != null) {
                    val reader = BufferedReader(InputStreamReader(stream))
                    val text = reader.readText()
                    reader.close()
                    text
                } else ""
                conn.disconnect()

                val inner = JSONObject()
                inner.put("status", code)
                inner.put("data", content)
                inner.put("success", code in 200..299)
                inner.toString()
            } catch (e: Exception) {
                val err = JSONObject()
                err.put("success", false)
                err.put("error", e.message ?: "Network error")
                err.toString()
            }
        }
        return try {
            future.get(timeoutMs + 1000L, java.util.concurrent.TimeUnit.MILLISECONDS)
        } catch (e: Exception) {
            result.put("success", false)
            result.put("error", e.message ?: "Timeout")
            result.toString()
        }
    }

    @JavascriptInterface
    fun getVisibleBssids(): String {
        val array = JSONArray()
        try {
            val scans = wifiManager?.scanResults ?: emptyList()
            for (scan in scans) {
                val obj = JSONObject()
                obj.put("ssid", scan.SSID ?: "")
                obj.put("bssid", (scan.BSSID ?: "").lowercase())
                obj.put("rssi", scan.level)
                val band = when {
                    scan.frequency in 2400..2500 -> "2.4 GHz"
                    scan.frequency in 4900..5900 -> "5 GHz"
                    scan.frequency in 5925..7125 -> "6 GHz"
                    else -> "Wi-Fi"
                }
                obj.put("band", band)
                obj.put("frequency", scan.frequency)
                obj.put("signal", WifiManager.calculateSignalLevel(scan.level, 101))
                array.put(obj)
            }
        } catch (e: Exception) {
            // Permission or scan throttle
        }
        return array.toString()
    }

    @JavascriptInterface
    fun discoverMeshNodes(gatewayIp: String, subnetPrefix: String): String {
        val nodesArray = JSONArray()
        try {
            val prefix = if (subnetPrefix.isNotEmpty() && subnetPrefix.endsWith(".")) {
                subnetPrefix
            } else if (gatewayIp.isNotEmpty()) {
                gatewayIp.substring(0, gatewayIp.lastIndexOf('.') + 1)
            } else {
                "192.168.1."
            }

            val tasks = mutableListOf<Callable<JSONObject?>>()
            for (i in 1..254) {
                val targetIp = "$prefix$i"
                tasks.add(Callable {
                    try {
                        val url = URL("http://$targetIp/api/v1/status")
                        val conn = url.openConnection() as HttpURLConnection
                        conn.connectTimeout = 450
                        conn.readTimeout = 450
                        conn.requestMethod = "GET"
                        conn.setRequestProperty("Accept", "application/json")

                        if (conn.responseCode == 200) {
                            val stream = conn.inputStream
                            val reader = BufferedReader(InputStreamReader(stream))
                            val content = reader.readText()
                            reader.close()
                            conn.disconnect()

                            val rootJson = JSONObject(content)
                            if (rootJson.has("system")) {
                                val sys = rootJson.getJSONObject("system")
                                val nodeObj = JSONObject()
                                nodeObj.put("ip", targetIp)
                                nodeObj.put("model", sys.optString("modelId", "Nest Wifi Pro"))
                                nodeObj.put("role", sys.optString("groupRole", if (targetIp == gatewayIp) "root" else "leaf"))
                                nodeObj.put("hardwareId", sys.optString("hardwareId", ""))
                                nodeObj.put("uptime", sys.optLong("uptime", 0L))
                                nodeObj.put("lanLink", sys.optBoolean("lan0Link", false))

                                if (rootJson.has("wan")) {
                                    val wan = rootJson.getJSONObject("wan")
                                    nodeObj.put("ethernetLink", wan.optBoolean("ethernetLink", false))
                                    nodeObj.put("wanOnline", wan.optBoolean("online", true))
                                }
                                if (rootJson.has("software")) {
                                    val sw = rootJson.getJSONObject("software")
                                    nodeObj.put("softwareVersion", sw.optString("softwareVersion", ""))
                                }
                                if (rootJson.has("meshInfo")) {
                                    val mesh = rootJson.getJSONObject("meshInfo")
                                    nodeObj.put("meshChannel", mesh.optInt("mesh-channel", 0))
                                }
                                return@Callable nodeObj
                            }
                        } else {
                            conn.disconnect()
                        }
                    } catch (e: Exception) {
                        // Node not responding or not a mesh API endpoint
                    }
                    null
                })
            }

            val futures: List<Future<JSONObject?>> = executor.invokeAll(tasks, 2500L, TimeUnit.MILLISECONDS)
            val discoveredList = mutableListOf<JSONObject>()
            for (f in futures) {
                try {
                    val obj = f.get()
                    if (obj != null) {
                        discoveredList.add(obj)
                    }
                } catch (e: Exception) {}
            }

            // Immediately refresh ARP table AFTER sending packets to each node so the kernel ARP cache is populated!
            val arpMap = getArpTable()
            for (nodeObj in discoveredList) {
                val ip = nodeObj.optString("ip", "")
                val mac = arpMap[ip] ?: ""
                nodeObj.put("mac", mac)
                nodesArray.put(nodeObj)
            }
        } catch (e: Exception) {
            // General discovery error
        }
        return nodesArray.toString()
    }

    private fun getArpTable(): Map<String, String> {
        val map = mutableMapOf<String, String>()
        val macRegex = "([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}".toRegex()
        val ipRegex = "^([0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3})$".toRegex()
        try {
            val process = Runtime.getRuntime().exec("ip neigh")
            val reader = BufferedReader(InputStreamReader(process.inputStream))
            var line: String?
            while (reader.readLine().also { line = it } != null) {
                val parts = line!!.trim().split("\\s+".toRegex())
                var ip: String? = null
                var mac: String? = null
                for (p in parts) {
                    if (ip == null && p.matches(ipRegex)) {
                        ip = p
                    } else if (p.matches(macRegex) && p != "00:00:00:00:00:00") {
                        mac = p.lowercase().replace('-', ':')
                    }
                }
                if (ip != null && mac != null) {
                    map[ip] = mac
                }
            }
            reader.close()
            process.waitFor()
        } catch (e: Exception) {}
        try {
            val file = java.io.File("/proc/net/arp")
            if (file.exists()) {
                file.forEachLine { l ->
                    val parts = l.trim().split("\\s+".toRegex())
                    var ip: String? = null
                    var mac: String? = null
                    for (p in parts) {
                        if (ip == null && p.matches(ipRegex)) {
                            ip = p
                        } else if (p.matches(macRegex) && p != "00:00:00:00:00:00") {
                            mac = p.lowercase().replace('-', ':')
                        }
                    }
                    if (ip != null && mac != null && !map.containsKey(ip)) {
                        map[ip] = mac
                    }
                }
            }
        } catch (ex: Exception) {}
        return map
    }

    @JavascriptInterface
    fun getConnectedDevices(): String {
        val array = JSONArray()
        val macRegex = "([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}".toRegex()
        val ipRegex = "^([0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3})$".toRegex()
        try {
            val process = Runtime.getRuntime().exec("ip neigh")
            val reader = BufferedReader(InputStreamReader(process.inputStream))
            var line: String?
            while (reader.readLine().also { line = it } != null) {
                val parts = line!!.trim().split("\\s+".toRegex())
                var ip: String? = null
                var mac: String? = null
                for (p in parts) {
                    if (ip == null && p.matches(ipRegex)) {
                        ip = p
                    } else if (p.matches(macRegex) && p != "00:00:00:00:00:00") {
                        mac = p.lowercase().replace('-', ':')
                    }
                }
                if (ip != null && mac != null) {
                    val obj = JSONObject()
                    obj.put("ip", ip)
                    obj.put("mac", mac)
                    obj.put("status", if (parts.size > 5) parts[parts.size - 1] else "REACHABLE")
                    array.put(obj)
                }
            }
            reader.close()
            process.waitFor()
        } catch (e: Exception) {
            // fallback
        }
        return array.toString()
    }

    private fun formatIp(ip: Int): String {
        return String.format(
            "%d.%d.%d.%d",
            ip and 0xff,
            ip shr 8 and 0xff,
            ip shr 16 and 0xff,
            ip shr 24 and 0xff
        )
    }
}
