package com.meshpulse.app

import android.content.Context
import android.net.ConnectivityManager
import android.net.wifi.WifiManager
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.URL
import java.util.concurrent.Executors

class AndroidBridge(private val context: Context) {

    private val executor = Executors.newCachedThreadPool()
    private val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
    private val connManager = context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager

    @JavascriptInterface
    fun isAndroid(): Boolean = true

    @JavascriptInterface
    fun getWifiInfo(): String {
        val result = JSONObject()
        try {
            val info = wifiManager?.connectionInfo
            val dhcp = wifiManager?.dhcpInfo

            if (info != null && info.networkId != -1) {
                var ssid = info.ssid ?: ""
                if (ssid.startsWith("\"") && ssid.endsWith("\"")) {
                    ssid = ssid.substring(1, ssid.length - 1)
                }

                val bssid = info.bssid ?: ""
                val rssi = info.rssi
                val freq = info.frequency
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
                    "192.168.86.1"
                }

                val localIp = if (dhcp != null && dhcp.ipAddress != 0) {
                    formatIp(dhcp.ipAddress)
                } else {
                    "Local Device"
                }

                val linkSpeed = info.linkSpeed

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
