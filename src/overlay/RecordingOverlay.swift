import Cocoa

class RecordingOverlayWindow: NSWindow {
    init() {
        let screenFrame = NSScreen.main?.frame ?? NSRect(x: 0, y: 0, width: 800, height: 600)
        let windowWidth: CGFloat = 70
        let windowHeight: CGFloat = 30
        let padding: CGFloat = 20

        // Position in top-right corner
        let windowFrame = NSRect(
            x: screenFrame.maxX - windowWidth - padding,
            y: screenFrame.maxY - windowHeight - padding - 25, // Account for menu bar
            width: windowWidth,
            height: windowHeight
        )

        super.init(
            contentRect: windowFrame,
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )

        // Window properties
        self.isOpaque = false
        self.backgroundColor = .clear
        self.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.maximumWindow)))
        self.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        self.ignoresMouseEvents = true
        self.hasShadow = false

        // Create content view
        let contentView = NSView(frame: NSRect(x: 0, y: 0, width: windowWidth, height: windowHeight))
        contentView.wantsLayer = true
        contentView.layer?.cornerRadius = 8
        contentView.layer?.backgroundColor = NSColor(red: 0.1, green: 0.1, blue: 0.1, alpha: 0.85).cgColor

        // Red dot
        let dotSize: CGFloat = 12
        let dotView = NSView(frame: NSRect(x: 10, y: (windowHeight - dotSize) / 2, width: dotSize, height: dotSize))
        dotView.wantsLayer = true
        dotView.layer?.cornerRadius = dotSize / 2
        dotView.layer?.backgroundColor = NSColor.red.cgColor

        // Pulsing animation for the dot
        let pulseAnimation = CABasicAnimation(keyPath: "opacity")
        pulseAnimation.fromValue = 1.0
        pulseAnimation.toValue = 0.4
        pulseAnimation.duration = 0.8
        pulseAnimation.autoreverses = true
        pulseAnimation.repeatCount = .infinity
        dotView.layer?.add(pulseAnimation, forKey: "pulse")

        // "REC" label
        let label = NSTextField(labelWithString: "REC")
        label.frame = NSRect(x: 26, y: (windowHeight - 16) / 2, width: 40, height: 16)
        label.font = NSFont.boldSystemFont(ofSize: 11)
        label.textColor = .white
        label.isBezeled = false
        label.drawsBackground = false
        label.isEditable = false
        label.isSelectable = false

        contentView.addSubview(dotView)
        contentView.addSubview(label)
        self.contentView = contentView
    }
}

class AppDelegate: NSObject, NSApplicationDelegate {
    var window: RecordingOverlayWindow!

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Hide from dock
        NSApp.setActivationPolicy(.accessory)

        window = RecordingOverlayWindow()
        window.makeKeyAndOrderFront(nil)
    }
}

// Main
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
