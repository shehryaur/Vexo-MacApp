import ApplicationServices
import CoreGraphics
import Darwin
import Foundation
import OpenDirectory

// One-shot helper. Prints a single JSON object. Never prints stdin (clicks, text, or passwords).

struct Bounds: Encodable {
    var x: Double
    var y: Double
    var width: Double
    var height: Double
}

struct Win: Encodable {
    var windowId: Int
    var title: String
    var app: String
    var bounds: Bounds
}

struct Reply: Encodable {
    var ok: Bool
    var reason: String? = nil
    var windows: [Win]? = nil
    var locked: Bool? = nil
}

struct Payload: Decodable {
    var x: Double?
    var y: Double?
    var windowId: Int?
    var text: String?
    var key: String?
    var user: String?
    var password: String?
}

enum Stdin {
    case empty
    case value(Payload)
    case bad
}

enum LockState {
    case locked
    case unlocked
    case unknown
}

enum Verdict {
    case ok
    case mismatch
    case unavailable
}

let accessDeniedReason =
    "Accessibility permission is missing. Enable it in System Settings → Privacy & Security → Accessibility."

typealias SessionCopy = @convention(c) () -> Unmanaged<CFDictionary>?

func emit(_ reply: Reply) -> Never {
    let data = (try? JSONEncoder().encode(reply)) ?? Data(#"{"ok":false,"reason":"encode_failed"}"#.utf8)
    try? FileHandle.standardOutput.write(contentsOf: data)
    try? FileHandle.standardOutput.write(contentsOf: Data([0x0A]))
    exit(reply.ok ? 0 : 1)
}

func fail(_ reason: String) -> Never {
    emit(Reply(ok: false, reason: reason))
}

func succeed() -> Never {
    emit(Reply(ok: true))
}

func readInput() -> Stdin {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    if data.isEmpty { return .empty }
    guard let payload = try? JSONDecoder().decode(Payload.self, from: data) else { return .bad }
    return .value(payload)
}

func sessionDictionary() -> NSDictionary? {
    _ = CGMainDisplayID()
    guard let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CGSessionCopyCurrentDictionary") else {
        return nil
    }
    let copy = unsafeBitCast(symbol, to: SessionCopy.self)
    guard let dictionary = copy() else { return nil }
    return dictionary.takeRetainedValue()
}

func sessionLock() -> LockState {
    guard let dictionary = sessionDictionary() else { return .unknown }
    let value = dictionary["CGSSessionScreenIsLocked"]
    if value == nil { return .unlocked }
    if let number = value as? NSNumber {
        return number.intValue != 0 ? .locked : .unlocked
    }
    return .unknown
}

func ensureAccess() -> String? {
    if AXIsProcessTrusted() && CGPreflightPostEventAccess() { return nil }
    let prompt = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
    let options = [prompt: true] as CFDictionary
    _ = AXIsProcessTrustedWithOptions(options)
    if AXIsProcessTrusted() && CGPreflightPostEventAccess() { return nil }
    return accessDeniedReason
}

func raiseWindow(windowId: Int) {
    guard
        let list = CGWindowListCopyWindowInfo([.optionIncludingWindow], CGWindowID(windowId)) as? [[String: Any]],
        let row = list.first,
        let pidNumber = row[kCGWindowOwnerPID as String] as? NSNumber
    else { return }
    let pid = pid_t(pidNumber.int32Value)
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetAttributeValue(app, kAXFrontmostAttribute as CFString, kCFBooleanTrue)
    var raw: CFTypeRef?
    if AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &raw) == .success,
       let windows = raw as? [AXUIElement] {
        var raised = false
        for window in windows {
            var numberRaw: CFTypeRef?
            if AXUIElementCopyAttributeValue(window, "AXWindowNumber" as CFString, &numberRaw) == .success,
               let number = numberRaw as? NSNumber,
               number.intValue == windowId {
                AXUIElementPerformAction(window, kAXRaiseAction as CFString)
                raised = true
                break
            }
        }
        if !raised, let first = windows.first {
            AXUIElementPerformAction(first, kAXRaiseAction as CFString)
        }
    }
    usleep(150_000)
}

func postClick(x: Double, y: Double) {
    let source = CGEventSource(stateID: .hidSystemState)
    let point = CGPoint(x: x, y: y)
    CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)?
        .post(tap: .cghidEventTap)
    usleep(40_000)
    let down = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)
    down?.setIntegerValueField(.mouseEventClickState, value: 1)
    down?.post(tap: .cghidEventTap)
    usleep(30_000)
    let up = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)
    up?.setIntegerValueField(.mouseEventClickState, value: 1)
    up?.post(tap: .cghidEventTap)
}

func typeText(_ text: String) {
    let source = CGEventSource(stateID: .hidSystemState)
    for character in text {
        let units = Array(String(character).utf16)
        guard
            let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
            let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
        else { continue }
        units.withUnsafeBufferPointer { buffer in
            guard let base = buffer.baseAddress else { return }
            down.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: base)
            up.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: base)
        }
        down.flags = []
        up.flags = []
        down.post(tap: .cghidEventTap)
        usleep(8_000)
        up.post(tap: .cghidEventTap)
        usleep(30_000)
    }
}

func keyCode(_ name: String) -> CGKeyCode? {
    switch name {
    case "return": return 0x24
    case "enter": return 0x4C
    case "escape", "esc": return 0x35
    case "tab": return 0x30
    case "space": return 0x31
    case "delete", "backspace": return 0x33
    case "forwarddelete": return 0x75
    case "left": return 0x7B
    case "right": return 0x7C
    case "down": return 0x7D
    case "up": return 0x7E
    default: return nil
    }
}

func postKey(_ code: CGKeyCode) {
    let source = CGEventSource(stateID: .hidSystemState)
    let down = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true)
    let up = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false)
    down?.flags = []
    up?.flags = []
    down?.post(tap: .cghidEventTap)
    usleep(8_000)
    up?.post(tap: .cghidEventTap)
}

func listWindows() -> Never {
    let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let info = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
        emit(Reply(ok: true, windows: []))
    }
    var windows: [Win] = []
    for row in info {
        let layer = (row[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0
        if layer != 0 { continue }
        guard let windowId = (row[kCGWindowNumber as String] as? NSNumber)?.intValue else { continue }
        guard let rawBounds = row[kCGWindowBounds as String] as? [String: Any] else { continue }
        func number(_ key: String) -> Double? {
            (rawBounds[key] as? NSNumber)?.doubleValue
        }
        guard
            let x = number("X"),
            let y = number("Y"),
            let width = number("Width"),
            let height = number("Height"),
            width > 1,
            height > 1
        else { continue }
        let title = row[kCGWindowName as String] as? String ?? ""
        let app = row[kCGWindowOwnerName as String] as? String ?? ""
        windows.append(
            Win(
                windowId: windowId,
                title: title,
                app: app,
                bounds: Bounds(x: x, y: y, width: width, height: height)
            )
        )
    }
    emit(Reply(ok: true, windows: windows))
}

func reportLocked() -> Never {
    switch sessionLock() {
    case .locked:
        emit(Reply(ok: true, locked: true))
    case .unlocked:
        emit(Reply(ok: true, locked: false))
    case .unknown:
        fail("lock_state_unknown")
    }
}

func checkPassword(user: String, password: String) -> Verdict {
    do {
        let node = try ODNode(session: ODSession.default(), type: ODNodeType(kODNodeTypeLocalNodes))
        let record = try node.record(withRecordType: kODRecordTypeUsers as String, name: user, attributes: nil)
        do {
            try record.verifyPassword(password)
            return .ok
        } catch {
            return .mismatch
        }
    } catch {
        return .unavailable
    }
}

func verify(_ input: Stdin) -> Never {
    guard case .value(let payload) = input, let user = payload.user, let password = payload.password else {
        fail("unavailable")
    }
    switch checkPassword(user: user, password: password) {
    case .ok:
        succeed()
    case .mismatch:
        fail("mismatch")
    case .unavailable:
        fail("unavailable")
    }
}

func click(_ input: Stdin) -> Never {
    guard case .value(let payload) = input else { fail("bad_input") }
    if let reason = ensureAccess() { fail(reason) }
    guard let x = payload.x, let y = payload.y else { fail("bad_point") }
    if let windowId = payload.windowId {
        raiseWindow(windowId: windowId)
    }
    postClick(x: x, y: y)
    succeed()
}

func typeOp(_ input: Stdin) -> Never {
    guard case .value(let payload) = input else { fail("bad_input") }
    if let reason = ensureAccess() { fail(reason) }
    guard let text = payload.text, !text.isEmpty else { fail("empty") }
    if let windowId = payload.windowId {
        raiseWindow(windowId: windowId)
    }
    typeText(text)
    succeed()
}

func keyOp(_ input: Stdin) -> Never {
    guard case .value(let payload) = input else { fail("bad_input") }
    if let reason = ensureAccess() { fail(reason) }
    guard let name = payload.key, let code = keyCode(name) else { fail("unknown_key") }
    if let windowId = payload.windowId {
        raiseWindow(windowId: windowId)
    }
    postKey(code)
    succeed()
}

func lockType(_ input: Stdin) -> Never {
    guard case .value(let payload) = input else { fail("bad_input") }
    switch sessionLock() {
    case .locked:
        break
    case .unlocked:
        fail("not_locked")
    case .unknown:
        fail("lock_state_unknown")
    }
    if let reason = ensureAccess() { fail(reason) }
    guard let text = payload.text, !text.isEmpty else { fail("empty") }
    typeText(text)
    postKey(0x24)
    for _ in 0..<8 {
        usleep(250_000)
        if sessionLock() == .unlocked { succeed() }
    }
    if sessionLock() == .locked { fail("lock_screen_rejected") }
    fail("lock_state_unknown")
}

let operation = CommandLine.arguments.dropFirst().first ?? ""
let input = readInput()
switch operation {
case "windows":
    listWindows()
case "locked":
    reportLocked()
case "verify":
    verify(input)
case "click":
    click(input)
case "type":
    typeOp(input)
case "key":
    keyOp(input)
case "lock-type":
    lockType(input)
default:
    fail("unknown_op")
}
