import Flutter
import UIKit
import UserNotifications

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private let notificationChannelName = "teamagentx/notifications"
  private var notificationChannel: FlutterMethodChannel?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    let launched = super.application(application, didFinishLaunchingWithOptions: launchOptions)
    registerNotificationChannel()
    return launched
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
  }

  private func registerNotificationChannel() {
    guard let controller = window?.rootViewController as? FlutterViewController else {
      return
    }

    let channel = FlutterMethodChannel(
      name: notificationChannelName,
      binaryMessenger: controller.binaryMessenger
    )

    channel.setMethodCallHandler { [weak self] call, result in
      switch call.method {
      case "setBadgeCount":
        let args = call.arguments as? [String: Any]
        let count = args?["count"] as? Int ?? 0
        DispatchQueue.main.async {
          UIApplication.shared.applicationIconBadgeNumber = max(count, 0)
          result(nil)
        }
      case "showMessage":
        let args = call.arguments as? [String: Any]
        let title = args?["title"] as? String ?? "TeamAgentX"
        let body = args?["body"] as? String ?? "有新消息"
        let chatRoomId = args?["chatRoomId"] as? String
        let count = args?["count"] as? Int ?? 0
        self?.showMessageNotification(title: title, body: body, chatRoomId: chatRoomId, count: count)
        result(nil)
      default:
        result(FlutterMethodNotImplemented)
      }
    }
    notificationChannel = channel
    UNUserNotificationCenter.current().delegate = self
  }

  private func showMessageNotification(title: String, body: String, chatRoomId: String?, count: Int) {
    let center = UNUserNotificationCenter.current()
    center.requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
      guard granted else {
        return
      }

      let content = UNMutableNotificationContent()
      content.title = title
      content.body = body
      content.sound = .default
      content.badge = NSNumber(value: max(count, 0))
      if let chatRoomId = chatRoomId {
        content.userInfo = ["chatRoomId": chatRoomId]
      }

      let request = UNNotificationRequest(
        identifier: UUID().uuidString,
        content: content,
        trigger: nil
      )
      center.add(request)
    }
  }

  override func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    let chatRoomId = response.notification.request.content.userInfo["chatRoomId"] as? String
    if let chatRoomId = chatRoomId, !chatRoomId.isEmpty {
      notificationChannel?.invokeMethod("notificationOpened", arguments: ["chatRoomId": chatRoomId])
    }
    completionHandler()
  }
}
