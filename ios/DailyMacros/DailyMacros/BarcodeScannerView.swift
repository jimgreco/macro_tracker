import SwiftUI
import AVFoundation

struct BarcodeScannerView: UIViewControllerRepresentable {
    var onCodeScanned: (String) -> Void
    var onError: (String) -> Void

    func makeUIViewController(context: Context) -> BarcodeScannerViewController {
        BarcodeScannerViewController(
            onCodeScanned: onCodeScanned,
            onError: onError
        )
    }

    func updateUIViewController(_ uiViewController: BarcodeScannerViewController, context: Context) {}
}

final class BarcodeScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    private let onCodeScanned: (String) -> Void
    private let onError: (String) -> Void
    private let session = AVCaptureSession()
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var didScan = false

    init(onCodeScanned: @escaping (String) -> Void, onError: @escaping (String) -> Void) {
        self.onCodeScanned = onCodeScanned
        self.onError = onError
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        configureScanner()
        addScanFrame()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        stopSession()
    }

    private func configureScanner() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            configureSession()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    if granted {
                        self?.configureSession()
                    } else {
                        self?.onError("Camera access is required to scan barcodes.")
                    }
                }
            }
        case .denied, .restricted:
            onError("Camera access is required to scan barcodes.")
        @unknown default:
            onError("Camera access is unavailable.")
        }
    }

    private func configureSession() {
        guard let device = AVCaptureDevice.default(for: .video) else {
            onError("This device does not have a camera.")
            return
        }

        do {
            let input = try AVCaptureDeviceInput(device: device)
            guard session.canAddInput(input) else {
                onError("Unable to start barcode scanner.")
                return
            }
            session.addInput(input)
        } catch {
            onError("Unable to start barcode scanner.")
            return
        }

        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else {
            onError("Unable to read barcodes from the camera.")
            return
        }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: DispatchQueue.main)

        let preferredTypes: [AVMetadataObject.ObjectType] = [
            .ean13,
            .ean8,
            .upce,
            .code128,
            .code39,
            .code93,
            .itf14,
            .interleaved2of5
        ]
        let supportedTypes = preferredTypes.filter { output.availableMetadataObjectTypes.contains($0) }
        guard !supportedTypes.isEmpty else {
            onError("Barcode scanning is not available on this device.")
            return
        }
        output.metadataObjectTypes = supportedTypes

        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        layer.frame = view.bounds
        view.layer.insertSublayer(layer, at: 0)
        previewLayer = layer

        DispatchQueue.global(qos: .userInitiated).async { [session] in
            session.startRunning()
        }
    }

    private func addScanFrame() {
        let frameView = UIView()
        frameView.translatesAutoresizingMaskIntoConstraints = false
        frameView.layer.borderColor = UIColor.systemGreen.cgColor
        frameView.layer.borderWidth = 3
        frameView.layer.cornerRadius = 18
        frameView.backgroundColor = .clear
        view.addSubview(frameView)

        NSLayoutConstraint.activate([
            frameView.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            frameView.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            frameView.widthAnchor.constraint(equalTo: view.widthAnchor, multiplier: 0.78),
            frameView.heightAnchor.constraint(equalToConstant: 170)
        ])
    }

    private func stopSession() {
        guard session.isRunning else { return }
        DispatchQueue.global(qos: .userInitiated).async { [session] in
            session.stopRunning()
        }
    }

    func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard !didScan else { return }
        guard let object = metadataObjects.compactMap({ $0 as? AVMetadataMachineReadableCodeObject }).first,
              let value = object.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty else {
            return
        }

        didScan = true
        stopSession()
        onCodeScanned(value)
    }
}
