import SwiftUI
import AppKit
import ServiceManagement

struct QueueEntry: Identifiable {
    let id: String
    let filename: String
    let status: String
    let position: Int?
    let waiting: Int
    let duration: Double
    let progress: Int
    let onThisWorker: Bool
    let stems: String
    let workerName: String
}

struct ActiveJob: Identifiable {
    let id: String
    let filename: String
    let progress: Int
    let device: String
    let slot: Int
}

struct FleetEntry: Identifiable {
    let id: String
    let name: String
    let online: Bool
    let accepting: Bool
    let busy: Bool
    let activeJobs: Int
    let onThisWorker: Bool
}

@MainActor final class WorkerModel: ObservableObject {
    @Published var message = "กำลังเริ่มเครื่องประมวลผล…"
    @Published var filename = ""
    @Published var progress = 0
    @Published var device = ""
    @Published var state = "starting"
    @Published var paused = false
    @Published var startHour = 0
    @Published var endHour = 0
    @Published var login = false
    @Published var quality = "standard"
    @Published var parallelJobs = 0
    @Published var hardwareLimit = 1
    @Published var parallelLimit = 1
    @Published var hardwareSummary = "กำลังตรวจสเปคเครื่อง…"
    @Published var capacityReason = ""
    @Published var activeJobs: [ActiveJob] = []
    @Published var settingsError = ""
    @Published var queue: [QueueEntry] = []
    @Published var fleet: [FleetEntry] = []
    @Published var waiting = 0
    @Published var processing = 0
    @Published var preparing = 0
    @Published var queueUpdated: Double = 0
    @Published var queueStale = true
    @Published var serverAlerts: [String] = []
    private var process: Process?
    private var timer: Timer?
    private var nextStart = Date.distantPast
    let root = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/STEMORA Worker", isDirectory: true)

    init() {
        if let control = read("control.json") {
            paused = control["paused"] as? Bool ?? false
            startHour = control["start_hour"] as? Int ?? 0
            endHour = control["end_hour"] as? Int ?? 0
            quality = control["quality"] as? String ?? "standard"
            parallelJobs = control["parallel_jobs"] as? Int ?? 0
        }
        login = SMAppService.mainApp.status == .enabled
        startAgent()
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
    }

    func read(_ name: String) -> [String: Any]? {
        guard let data = try? Data(contentsOf: root.appendingPathComponent(name)) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    func startAgent() {
        guard process?.isRunning != true, Date() >= nextStart else { return }
        guard let config = read("config.json"), let python = config["python"] as? String,
              let script = Bundle.main.url(forResource: "agent", withExtension: "py") else {
            message = "ยังไม่ได้ตั้งค่าเครื่องนี้ ดูคู่มือในโฟลเดอร์โปรเจกต์"
            state = "error"
            return
        }
        let child = Process()
        child.executableURL = URL(fileURLWithPath: python)
        child.arguments = [script.path, "--config", root.appendingPathComponent("config.json").path]
        let logfile = root.appendingPathComponent("agent.log")
        if !FileManager.default.fileExists(atPath: logfile.path) {
            FileManager.default.createFile(atPath: logfile.path, contents: nil, attributes: [.posixPermissions: 0o600])
        }
        if let handle = try? FileHandle(forWritingTo: logfile) {
            _ = try? handle.seekToEnd()
            child.standardOutput = handle
            child.standardError = handle
        }
        do { try child.run(); process = child }
        catch { message = "เริ่มตัวประมวลผลไม่ได้ กรุณาตรวจ runtime"; state = "error" }
        nextStart = Date().addingTimeInterval(15)
    }

    func refresh() {
        startAgent()
        guard let status = read("status.json") else { return }
        message = status["message"] as? String ?? ""
        filename = status["filename"] as? String ?? ""
        progress = status["progress"] as? Int ?? 0
        device = status["device"] as? String ?? ""
        state = status["state"] as? String ?? ""
        if let capacity = status["capacity"] as? [String: Any] {
            hardwareLimit = max(1, capacity["hardware_limit"] as? Int ?? 1)
            parallelLimit = capacity["parallelism"] as? Int ?? 1
            hardwareSummary = "\(capacity["chip"] as? String ?? "Mac") · RAM \(capacity["memory_gb"] as? Int ?? 0) GB · รับได้ \(parallelLimit) งานพร้อมกัน"
            capacityReason = capacity["reason"] as? String ?? ""
        }
        activeJobs = (status["active_jobs"] as? [[String: Any]] ?? []).compactMap { item in
            guard let id = item["task_id"] as? String, let filename = item["filename"] as? String else { return nil }
            return ActiveJob(id: id, filename: filename, progress: item["progress"] as? Int ?? 0,
                             device: item["device"] as? String ?? "", slot: item["slot"] as? Int ?? 0)
        }
        if let snapshot = read("queue.json") {
            fleet = (snapshot["workers"] as? [[String: Any]] ?? []).compactMap { item in
                guard let id = item["id"] as? String, let name = item["name"] as? String else { return nil }
                return FleetEntry(id: id, name: name, online: item["online"] as? Bool ?? false,
                    accepting: item["accepting"] as? Bool ?? false, busy: item["busy"] as? Bool ?? false, activeJobs: item["active_jobs"] as? Int ?? 0,
                    onThisWorker: item["on_this_worker"] as? Bool ?? false)
            }
            serverAlerts = snapshot["alerts"] as? [String] ?? []
            let counts = snapshot["counts"] as? [String: Any] ?? [:]
            waiting = counts["waiting"] as? Int ?? 0
            processing = counts["processing"] as? Int ?? 0
            preparing = counts["preparing"] as? Int ?? 0
            queueUpdated = snapshot["updated_at"] as? Double ?? 0
            queueStale = (snapshot["stale"] as? Bool ?? true) || Date().timeIntervalSince1970 - queueUpdated > 35
            queue = (snapshot["items"] as? [[String: Any]] ?? []).compactMap { item in
                guard let id = item["id"] as? String, let filename = item["filename"] as? String else { return nil }
                return QueueEntry(id: id, filename: filename, status: item["status"] as? String ?? "queued",
                    position: item["position"] as? Int, waiting: item["waiting_seconds"] as? Int ?? 0,
                    duration: item["duration"] as? Double ?? 0, progress: item["progress"] as? Int ?? 0,
                    onThisWorker: item["on_this_worker"] as? Bool ?? false, stems: item["stems_mode"] as? String ?? "4stems", workerName: item["worker_name"] as? String ?? "เครื่องอื่น")
            }
        }
    }

    func saveControl() {
        var control = read("control.json") ?? [:]
        control.merge(["paused": paused, "start_hour": startHour, "end_hour": endHour, "quality": quality, "parallel_jobs": parallelJobs]) { _, new in new }
        do {
            let data = try JSONSerialization.data(withJSONObject: control, options: .prettyPrinted)
            let url = root.appendingPathComponent("control.json")
            try data.write(to: url, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        } catch { settingsError = "บันทึกการตั้งค่าไม่สำเร็จ" }
    }

    func toggleLogin() {
        do {
            if login { try SMAppService.mainApp.register() }
            else { try SMAppService.mainApp.unregister() }
            settingsError = ""
        } catch {
            settingsError = "ตั้งค่าเริ่มอัตโนมัติไม่ได้ เปิด System Settings → General → Login Items เพื่อเพิ่มแอปนี้"
            login = SMAppService.mainApp.status == .enabled
        }
    }

    func quit() {
        timer?.invalidate()
        process?.terminate()
        // The agent releases its lease on termination; unacknowledged work is requeued by the server.
        NSApplication.shared.terminate(nil)
    }
}

struct QueuePanel: View {
    @ObservedObject var model: WorkerModel
    func clock(_ value: Int) -> String {
        let seconds = max(0, value)
        if seconds >= 3600 { return String(format: "%d:%02d:%02d", seconds / 3600, (seconds / 60) % 60, seconds % 60) }
        return String(format: "%02d:%02d", seconds / 60, seconds % 60)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !model.serverAlerts.isEmpty {
                VStack(alignment: .leading, spacing: 5) {
                    Label("เซิร์ฟเวอร์ต้องตรวจสอบ", systemImage: "exclamationmark.triangle.fill").font(.caption.bold())
                    ForEach(model.serverAlerts, id: \.self) { Text($0).font(.caption) }
                }.foregroundStyle(.orange).frame(maxWidth: .infinity, alignment: .leading).padding(10).background(.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 9))
            }
            HStack {
                Text("คิวแยกเสียงทั้งหมด").font(.headline)
                Spacer()
                Text(model.queueUpdated == 0 ? "รอเชื่อมต่อ" : model.queueStale ? "ข้อมูลล่าสุด · ออฟไลน์" : "อัปเดตทุก 10 วินาที")
                    .font(.caption).foregroundStyle(model.queueStale ? .orange : .secondary)
            }
            HStack(spacing: 10) {
                metric("รอคิว", model.waiting, "clock")
                metric("กำลังทำ", model.processing, "waveform")
                metric("เตรียมไฟล์", model.preparing, "arrow.up.doc")
            }
            if model.queue.isEmpty {
                Text(model.queueUpdated == 0 ? "กำลังตรวจคิวจากเซิร์ฟเวอร์…" : "ยังไม่มีงานในคิว")
                    .font(.callout).foregroundStyle(.secondary).padding(.vertical, 12)
            } else {
                ScrollView {
                    VStack(spacing: 8) {
                        ForEach(model.queue.sorted { ($0.status == "processing" ? 0 : $0.status == "queued" ? 1 : 2) < ($1.status == "processing" ? 0 : $1.status == "queued" ? 1 : 2) }) { item in
                            HStack(alignment: .top, spacing: 10) {
                                Text(item.position.map { "\($0)" } ?? (item.status == "processing" ? "▶" : "↑"))
                                    .font(.caption.monospacedDigit()).frame(width: 26, height: 26)
                                    .background(Color.white.opacity(0.08)).clipShape(RoundedRectangle(cornerRadius: 7))
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(item.filename).font(.callout).lineLimit(2).textSelection(.enabled)
                                    HStack {
                                        Text(item.status == "processing" ? (item.onThisWorker ? "เครื่องนี้กำลังทำ · \(item.progress)%" : "\(item.workerName.isEmpty ? "เครื่องอื่น" : item.workerName) · \(item.progress)%") : item.status == "staging" ? "กำลังเตรียมไฟล์" : "รอแล้ว \(clock(item.waiting + Int(max(0, Date().timeIntervalSince1970 - model.queueUpdated))))")
                                        Spacer()
                                        Text("\(item.stems == "2stems" ? "2" : "4") แทร็ค · \(clock(Int(item.duration)))")
                                    }.font(.caption).foregroundStyle(.secondary)
                                }
                            }.padding(10).background(item.onThisWorker ? Color.green.opacity(0.09) : Color.white.opacity(0.035)).clipShape(RoundedRectangle(cornerRadius: 10))
                        }
                    }
                }.frame(maxHeight: 240)
            }
            if !model.fleet.isEmpty {
                DisclosureGroup("เครื่องประมวลผล · ออนไลน์ \(model.queueStale ? "—" : "\(model.fleet.filter { $0.online }.count)") / \(model.fleet.count)") {
                    ForEach(model.fleet) { machine in
                        HStack {
                            Circle().fill(model.queueStale ? Color.orange : machine.online ? Color.green : Color.gray).frame(width: 6, height: 6)
                            Text(machine.name + (machine.onThisWorker ? " · เครื่องนี้" : "")).lineLimit(1)
                            Spacer()
                            Text(model.queueStale ? "รอเชื่อมต่อ" : !machine.online ? "ออฟไลน์" : machine.busy ? "กำลังทำ \(machine.activeJobs) งาน" : machine.accepting ? "พร้อมรับงาน" : "พักรับงาน")
                                .foregroundStyle(.secondary)
                        }.font(.caption).padding(.vertical, 3)
                    }
                }.font(.callout)
            }
            Text("ลำดับคือคิวรอรับงาน · เวลาแสดงว่ารอมาแล้ว ไม่ใช่เวลาเสร็จโดยประมาณ")
                .font(.caption2).foregroundStyle(.secondary)
        }
    }
    func metric(_ label: String, _ count: Int, _ icon: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(label, systemImage: icon).font(.caption).foregroundStyle(.secondary)
            Text(model.queueUpdated == 0 ? "—" : "\(count)").font(.title2.monospacedDigit().bold())
        }.frame(maxWidth: .infinity, alignment: .leading).padding(10)
            .background(Color.white.opacity(0.045)).clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

struct WorkerPanel: View {
    @ObservedObject var model: WorkerModel
    var body: some View {
        ScrollView {
        VStack(alignment: .leading, spacing: 15) {
            HStack {
                Image(systemName: "waveform.circle.fill").font(.largeTitle).foregroundStyle(Color(red: 0.75, green: 0.88, blue: 0.41))
                VStack(alignment: .leading) {
                    Text("STEMORA Worker").font(.title3.bold())
                    Text("เครื่องประมวลผลส่วนตัวของคุณ").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
            }
            Label(model.message, systemImage: model.state == "working" ? "waveform" : model.state == "error" ? "exclamationmark.circle" : "circle.fill")
                .font(.callout).fixedSize(horizontal: false, vertical: true)
            Text(model.hardwareSummary).font(.caption).foregroundStyle(.secondary)
            if !model.activeJobs.isEmpty {
                ForEach(model.activeJobs) { job in
                    VStack(alignment: .leading, spacing: 5) {
                        HStack {
                            Text("\(job.slot + 1)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                            Text(job.filename).font(.callout).lineLimit(2)
                            Spacer()
                            Text("\(job.progress)%").font(.caption.monospacedDigit())
                        }
                        ProgressView(value: Double(job.progress), total: 100)
                    }.padding(10).background(Color.white.opacity(0.04)).clipShape(RoundedRectangle(cornerRadius: 8))
                }
            } else if !model.filename.isEmpty {
                Text(model.filename).lineLimit(2)
                ProgressView(value: Double(model.progress), total: 100)
                Text("\(model.progress)% · \(model.device.uppercased())").font(.caption).foregroundStyle(.secondary)
            }
            QueuePanel(model: model)
            DisclosureGroup("การรับงานและการตั้งค่า") {
            Toggle("เปิดรับงานใหม่", isOn: Binding(get: { !model.paused }, set: { model.paused = !$0; model.saveControl() }))
            Text("พักรับงานจะปล่อยให้งานปัจจุบันทำจนเสร็จ").font(.caption).foregroundStyle(.secondary)
            Picker("งานพร้อมกัน", selection: $model.parallelJobs) {
                Text("อัตโนมัติตามสเปค").tag(0)
                ForEach(1...model.hardwareLimit, id: \.self) { Text("\($0) งาน").tag($0) }
            }.onChange(of: model.parallelJobs) { _, _ in model.saveControl() }
            Text("แบ่ง GPU และ RAM ร่วมกัน · ลดการรับงานใหม่เมื่อ RAM ตึง · งานที่เริ่มแล้วทำต่อจนเสร็จ")
                .font(.caption).foregroundStyle(.secondary)
            if !model.capacityReason.isEmpty { Text(model.capacityReason).font(.caption).foregroundStyle(.orange) }
            Picker("คุณภาพแยก 4 แทร็ค", selection: $model.quality) {
                Text("มาตรฐาน · เร็ว").tag("standard")
                Text("ละเอียด · ใช้เวลามากขึ้น").tag("high")
            }.onChange(of: model.quality) { _, _ in model.saveControl() }
            Text("เสียงร้อง/ดนตรีใช้ AI เฉพาะทางอัตโนมัติ · การตั้งค่าคุณภาพนี้ใช้กับ 4 แทร็ค").font(.caption).foregroundStyle(.secondary)
            Divider()
            Text("เวลารับงาน · ใช้เวลาของเครื่องนี้").font(.caption.bold())
            HStack {
                Picker("เริ่ม", selection: $model.startHour) { ForEach(0..<24) { Text(String(format: "%02d:00", $0)).tag($0) } }
                Picker("สิ้นสุด", selection: $model.endHour) { ForEach(0..<24) { Text(String(format: "%02d:00", $0)).tag($0) } }
            }.onChange(of: model.startHour) { _, _ in model.saveControl() }
                .onChange(of: model.endHour) { _, _ in model.saveControl() }
            Text("เวลาเริ่มและสิ้นสุดตรงกัน = รับงานทั้งวัน").font(.caption).foregroundStyle(.secondary)
            Toggle("เปิดพร้อมเข้าสู่ระบบ Mac", isOn: $model.login).onChange(of: model.login) { _, _ in model.toggleLogin() }
            if !model.settingsError.isEmpty { Text(model.settingsError).font(.caption).foregroundStyle(.orange) }
            }
            Divider()
            Text("เปิดรับงานจะป้องกันเครื่องพักเอง · จำนวนงานตามสเปค · หลายเครื่องช่วยกันรับคิว · เชื่อมต่ออินเทอร์เน็ตและเปิดจอฝาเครื่องไว้ · ไฟล์ส่งกลับ Cloud ส่วนตัว").font(.caption).foregroundStyle(.secondary)
            HStack {
                Button("เปิดเว็บไซต์") { NSWorkspace.shared.open(URL(string: "https://stemora.mydjplus.com")!) }
                Button("เปิดโฟลเดอร์สถานะ") { NSWorkspace.shared.open(model.root) }
                Spacer()
                Button("ออก") { model.quit() }
            }
        }.padding(20)
        }.frame(width: 470, height: min(760, (NSScreen.main?.visibleFrame.height ?? 860) - 100)).preferredColorScheme(.dark)
    }
}

@main struct StemoraWorkerApp: App {
    @StateObject var model = WorkerModel()
    var body: some Scene {
        WindowGroup("STEMORA Worker", id: "worker-status") {
            WorkerPanel(model: model)
        }.windowResizability(.contentSize)
        MenuBarExtra("STEMORA Worker", systemImage: "waveform") {
            WorkerPanel(model: model)
        }.menuBarExtraStyle(.window)
    }
}
