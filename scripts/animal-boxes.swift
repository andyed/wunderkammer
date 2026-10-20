// For each image path on stdin, one JSON line: the dogs and cats Apple's Vision
// framework finds in it, each with its label, confidence and the share of the
// frame its box covers. On-device; nothing is uploaded. photos-collection.py
// uses it to keep photos where the subject animal is more than a speck.
//
//   printf '%s\n' a.jpg b.jpg | swift scripts/animal-boxes.swift
import Foundation
import Vision

while let line = readLine() {
    let path = line.trimmingCharacters(in: .whitespacesAndNewlines)
    if path.isEmpty { continue }
    var record: [String: Any] = ["path": path]
    let request = VNRecognizeAnimalsRequest()
    let handler = VNImageRequestHandler(url: URL(fileURLWithPath: path), options: [:])
    do {
        try handler.perform([request])
        record["animals"] = (request.results ?? []).compactMap { observation -> [String: Any]? in
            guard let label = observation.labels.first else { return nil }
            let box = observation.boundingBox
            return ["label": label.identifier.lowercased(), "confidence": Double(label.confidence),
                    "area": Double(box.width * box.height)]
        }
    } catch {
        record["error"] = error.localizedDescription
    }
    let data = try! JSONSerialization.data(withJSONObject: record, options: [.sortedKeys])
    print(String(data: data, encoding: .utf8)!)
    fflush(stdout)
}
