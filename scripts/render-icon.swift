// Renders the Setbook app icons (light, dark, tinted) as 1024x1024 PNGs.
// Run from the repo root: swift scripts/render-icon.swift
import AppKit
import CoreGraphics

let size = 1024.0
let ink = CGColor(red: 0x0B / 255, green: 0x0B / 255, blue: 0x0C / 255, alpha: 1)
let paper = CGColor(red: 0xF5 / 255, green: 0xF5 / 255, blue: 0xF4 / 255, alpha: 1)

/// The same dumbbell as the in-app brand mark: two plates per side and a bar, all rounded.
func drawDumbbell(_ ctx: CGContext, color: CGColor) {
    ctx.setFillColor(color)
    let center = size / 2
    func pill(_ cx: Double, _ width: Double, _ height: Double) {
        let rect = CGRect(x: cx - width / 2, y: center - height / 2, width: width, height: height)
        ctx.addPath(CGPath(roundedRect: rect, cornerWidth: width * 0.42, cornerHeight: width * 0.42, transform: nil))
        ctx.fillPath()
    }
    // Bar
    let bar = CGRect(x: center - 250, y: center - 30, width: 500, height: 60)
    ctx.addPath(CGPath(roundedRect: bar, cornerWidth: 30, cornerHeight: 30, transform: nil))
    ctx.fillPath()
    // Inner plates, outer plates
    for side in [-1.0, 1.0] {
        pill(center + side * 178, 96, 392)
        pill(center + side * 290, 76, 236)
    }
}

func render(_ name: String, background: CGColor?, glyph: CGColor, opaque: Bool) throws {
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    let info: UInt32 = opaque ? CGImageAlphaInfo.noneSkipLast.rawValue : CGImageAlphaInfo.premultipliedLast.rawValue
    guard let ctx = CGContext(data: nil, width: Int(size), height: Int(size), bitsPerComponent: 8, bytesPerRow: 0, space: space, bitmapInfo: info) else {
        throw NSError(domain: "icon", code: 1)
    }
    if let background {
        ctx.setFillColor(background)
        ctx.fill(CGRect(x: 0, y: 0, width: size, height: size))
    } else {
        ctx.clear(CGRect(x: 0, y: 0, width: size, height: size))
    }
    drawDumbbell(ctx, color: glyph)
    guard let image = ctx.makeImage(),
          let data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
        throw NSError(domain: "icon", code: 2)
    }
    try data.write(to: URL(fileURLWithPath: name))
    print("wrote \(name)")
}

let dir = "App/Resources/Assets.xcassets/AppIcon.appiconset"
// Default icon: opaque, as iOS requires.
try render("\(dir)/AppIcon.png", background: paper, glyph: ink, opaque: true)
// Dark home screen: light glyph on a transparent background; iOS supplies the dark backdrop.
try render("\(dir)/AppIcon-Dark.png", background: nil, glyph: paper, opaque: false)
// Tinted home screen: a grayscale glyph that iOS colors with the user's tint.
try render("\(dir)/AppIcon-Tinted.png", background: nil, glyph: CGColor(gray: 1, alpha: 1), opaque: false)
// Web: home-screen icon for Safari's "Add to Home Screen".
try render("web/public/apple-touch-icon.png", background: paper, glyph: ink, opaque: true)
