package com.teamagentx.mobile_flutter

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val channelName = "teamagentx/notifications"
    private val notificationChannelId = "teamagentx_messages"
    private var notificationChannel: MethodChannel? = null
    private var pendingChatRoomId: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        pendingChatRoomId = intent?.getStringExtra("chatRoomId")
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        dispatchNotificationIntent(intent.getStringExtra("chatRoomId"))
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        notificationChannel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName)
        notificationChannel?.setMethodCallHandler { call, result ->
            when (call.method) {
                "setBadgeCount" -> {
                    result.success(null)
                }
                "showMessage" -> {
                    val title = call.argument<String>("title") ?: "TeamAgentX"
                    val body = call.argument<String>("body") ?: "有新消息"
                    val chatRoomId = call.argument<String>("chatRoomId")
                    val count = call.argument<Int>("count") ?: 0
                    showMessageNotification(title, body, chatRoomId, count)
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }
        dispatchNotificationIntent(pendingChatRoomId)
    }

    private fun dispatchNotificationIntent(chatRoomId: String?) {
        if (chatRoomId.isNullOrEmpty()) return
        pendingChatRoomId = null
        notificationChannel?.invokeMethod("notificationOpened", mapOf("chatRoomId" to chatRoomId))
    }

    private fun showMessageNotification(title: String, body: String, chatRoomId: String?, count: Int) {
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                notificationChannelId,
                "TeamAgentX 消息",
                NotificationManager.IMPORTANCE_DEFAULT
            )
            channel.setShowBadge(true)
            notificationManager.createNotificationChannel(channel)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1001)
            return
        }

        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("chatRoomId", chatRoomId)
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, notificationChannelId)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        val notification = builder
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(applicationInfo.icon)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setNumber(count.coerceAtLeast(0))
            .build()

        notificationManager.notify(1001, notification)
    }
}
