import CoreBluetooth
import Foundation

/// Public CoreBluetooth advertisement scan. Does not connect, pair, or read characteristics.
final class Spike: NSObject, CBCentralManagerDelegate {
    private var manager: CBCentralManager!
    private var rows: [String: [String: Any]] = [:]
    private var finished = false

    override init() {
        super.init()
        manager = CBCentralManager(delegate: self, queue: nil)
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        switch central.state {
        case .poweredOn:
            central.scanForPeripherals(
                withServices: nil,
                options: [CBCentralManagerScanOptionAllowDuplicatesKey: false]
            )
        case .poweredOff:
            emit(["ok": false, "reason": "powered_off"])
        case .unauthorized:
            emit(["ok": false, "reason": "unauthorized"])
        case .unsupported:
            emit(["ok": false, "reason": "unsupported"])
        default:
            break
        }
    }

    func centralManager(
        _ central: CBCentralManager,
        didDiscover peripheral: CBPeripheral,
        advertisementData: [String: Any],
        rssi: NSNumber
    ) {
        let local = advertisementData[CBAdvertisementDataLocalNameKey] as? String
        let name = peripheral.name ?? local ?? ""
        var uuids: [String] = []
        if let list = advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] {
            uuids.append(contentsOf: list.map { $0.uuidString })
        }
        if let overflow = advertisementData[CBAdvertisementDataOverflowServiceUUIDsKey] as? [CBUUID] {
            uuids.append(contentsOf: overflow.map { $0.uuidString })
        }
        if let solicited = advertisementData[CBAdvertisementDataSolicitedServiceUUIDsKey] as? [CBUUID] {
            uuids.append(contentsOf: solicited.map { $0.uuidString })
        }
        if let serviceData = advertisementData[CBAdvertisementDataServiceDataKey] as? [CBUUID: Data] {
            uuids.append(contentsOf: serviceData.keys.map { $0.uuidString })
        }
        let id = peripheral.identifier.uuidString
        rows[id] = [
            "name": name,
            "id": id,
            "connected": peripheral.state == .connected,
            "uuids": uuids,
        ]
        let isMatch = name.lowercased().contains("vexo") || uuids.contains(where: {
            $0.replacingOccurrences(of: "-", with: "").lowercased().contains("a8e9")
        })
        if isMatch || rows.count >= 128 {
            emit(["ok": true, "peripherals": Array(rows.values)])
        }
    }

    func finishTimeout() {
        emit(["ok": true, "peripherals": Array(rows.values)])
    }

    private func emit(_ object: [String: Any]) {
        if finished { return }
        finished = true
        manager.stopScan()
        if let data = try? JSONSerialization.data(withJSONObject: object),
           let text = String(data: data, encoding: .utf8) {
            print(text)
        } else {
            print("{\"ok\":false,\"reason\":\"unavailable\"}")
        }
        exit(0)
    }
}

let spike = Spike()
let deadline = Date().addingTimeInterval(3.5)
while Date() < deadline {
    RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.2))
}
spike.finishTimeout()
