#!/usr/bin/env swift

import AVFoundation
import CoreGraphics
import CoreVideo
import Foundation
import ImageIO

let width = 1080
let height = 1920
let fps: Int32 = 30
let secondsPerSlide = 3.5
let transitionSeconds = 0.35

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("\(message)\n".utf8))
    exit(1)
}

func loadImage(_ path: String) -> CGImage {
    let url = URL(fileURLWithPath: path) as CFURL
    guard let source = CGImageSourceCreateWithURL(url, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        fail("无法读取图像：\(path)")
    }
    return image
}

func makePixelBuffer(pool: CVPixelBufferPool) -> CVPixelBuffer {
    var buffer: CVPixelBuffer?
    let status = CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer)
    guard status == kCVReturnSuccess, let buffer else {
        fail("无法创建视频像素缓冲区：\(status)")
    }
    return buffer
}

func drawBackground(_ context: CGContext) {
    let colors = [
        CGColor(red: 0.024, green: 0.098, blue: 0.173, alpha: 1),
        CGColor(red: 0.051, green: 0.337, blue: 0.471, alpha: 1),
    ] as CFArray
    let locations: [CGFloat] = [0, 1]
    guard let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: locations) else {
        fail("无法创建视频背景渐变。")
    }
    context.drawLinearGradient(
        gradient,
        start: CGPoint(x: 0, y: CGFloat(height)),
        end: CGPoint(x: CGFloat(width), y: 0),
        options: []
    )
    context.setFillColor(CGColor(red: 0.941, green: 0.780, blue: 0.467, alpha: 0.95))
    context.fill(CGRect(x: 0, y: 0, width: 18, height: CGFloat(height)))
    context.setFillColor(CGColor(red: 0.941, green: 0.780, blue: 0.467, alpha: 0.18))
    context.fillEllipse(in: CGRect(x: 760, y: 1540, width: 520, height: 520))
    context.setStrokeColor(CGColor(red: 1, green: 1, blue: 1, alpha: 0.09))
    context.setLineWidth(3)
    context.strokeEllipse(in: CGRect(x: -240, y: -180, width: 680, height: 680))
}

func drawCard(_ image: CGImage, in context: CGContext, progress: Double, alpha: CGFloat) {
    let baseWidth: CGFloat = 960
    let baseHeight: CGFloat = 1280
    let scale = CGFloat(0.985 + 0.025 * progress)
    let cardWidth = baseWidth * scale
    let cardHeight = baseHeight * scale
    let target = CGRect(
        x: (CGFloat(width) - cardWidth) / 2,
        y: (CGFloat(height) - cardHeight) / 2,
        width: cardWidth,
        height: cardHeight
    )

    context.saveGState()
    context.setAlpha(alpha)
    context.setShadow(offset: CGSize(width: 0, height: -20), blur: 36, color: CGColor(red: 0, green: 0, blue: 0, alpha: 0.34))
    context.setFillColor(CGColor(gray: 1, alpha: 1))
    context.fill(target.insetBy(dx: -5, dy: -5))
    context.setShadow(offset: .zero, blur: 0, color: nil)
    context.interpolationQuality = .high
    context.draw(image, in: target)
    context.restoreGState()
}

func renderFrame(images: [CGImage], frame: Int, pool: CVPixelBufferPool) -> CVPixelBuffer {
    let time = Double(frame) / Double(fps)
    let slideIndex = min(images.count - 1, Int(time / secondsPerSlide))
    let localTime = time - Double(slideIndex) * secondsPerSlide
    let progress = min(1, max(0, localTime / secondsPerSlide))
    let transitionStart = secondsPerSlide - transitionSeconds
    let nextAlpha = slideIndex < images.count - 1
        ? CGFloat(min(1, max(0, (localTime - transitionStart) / transitionSeconds)))
        : 0

    let buffer = makePixelBuffer(pool: pool)
    CVPixelBufferLockBaseAddress(buffer, [])
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }

    guard let baseAddress = CVPixelBufferGetBaseAddress(buffer) else {
        fail("无法访问视频像素缓冲区。")
    }
    let bytesPerRow = CVPixelBufferGetBytesPerRow(buffer)
    guard let context = CGContext(
        data: baseAddress,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: bytesPerRow,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue
    ) else {
        fail("无法创建视频绘图上下文。")
    }

    drawBackground(context)
    drawCard(images[slideIndex], in: context, progress: progress, alpha: 1 - nextAlpha)
    if nextAlpha > 0 {
        drawCard(images[slideIndex + 1], in: context, progress: 0, alpha: nextAlpha)
    }
    return buffer
}

guard CommandLine.arguments.count >= 4 else {
    fail("用法：render-card-video.swift <输出.mp4> <01.png> ... <07.png>")
}

let outputPath = CommandLine.arguments[1]
let imagePaths = Array(CommandLine.arguments.dropFirst(2))
guard imagePaths.count == 7 else {
    fail("视频验证片必须接收 7 张图，实际收到 \(imagePaths.count) 张。")
}

let images = imagePaths.map(loadImage)
let outputURL = URL(fileURLWithPath: outputPath)
if FileManager.default.fileExists(atPath: outputPath) {
    try FileManager.default.removeItem(at: outputURL)
}

let writer: AVAssetWriter
do {
    writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
} catch {
    fail("无法创建视频文件：\(error.localizedDescription)")
}

let settings: [String: Any] = [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: width,
    AVVideoHeightKey: height,
    AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: 6_000_000,
        AVVideoMaxKeyFrameIntervalKey: 60,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
    ],
]
let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
input.expectsMediaDataInRealTime = false
let attributes: [String: Any] = [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    kCVPixelBufferWidthKey as String: width,
    kCVPixelBufferHeightKey as String: height,
    kCVPixelBufferCGImageCompatibilityKey as String: true,
    kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
]
let adaptor = AVAssetWriterInputPixelBufferAdaptor(
    assetWriterInput: input,
    sourcePixelBufferAttributes: attributes
)
guard writer.canAdd(input) else { fail("系统编码器无法添加 H.264 视频轨道。") }
writer.add(input)
guard writer.startWriting() else { fail("视频编码启动失败：\(writer.error?.localizedDescription ?? "未知错误")") }
writer.startSession(atSourceTime: .zero)
guard let pool = adaptor.pixelBufferPool else { fail("无法创建视频像素缓冲池。") }

let frameCount = Int(Double(images.count) * secondsPerSlide * Double(fps))
for frame in 0..<frameCount {
    while !input.isReadyForMoreMediaData {
        Thread.sleep(forTimeInterval: 0.003)
    }
    let buffer = renderFrame(images: images, frame: frame, pool: pool)
    let presentationTime = CMTime(value: CMTimeValue(frame), timescale: fps)
    if !adaptor.append(buffer, withPresentationTime: presentationTime) {
        fail("第 \(frame) 帧写入失败：\(writer.error?.localizedDescription ?? "未知错误")")
    }
}

input.markAsFinished()
let semaphore = DispatchSemaphore(value: 0)
writer.finishWriting { semaphore.signal() }
semaphore.wait()
guard writer.status == .completed else {
    fail("视频导出失败：\(writer.error?.localizedDescription ?? "未知错误")")
}

print("已生成 \(String(format: "%.1f", Double(frameCount) / Double(fps))) 秒竖屏验证片：\(outputPath)")
