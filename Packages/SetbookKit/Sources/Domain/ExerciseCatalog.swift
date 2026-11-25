import CryptoKit
import Foundation

/// The built-in strength catalog. IDs are derived from a stable slug so they never change
/// between launches or app versions; never rename a slug once shipped.
public enum ExerciseCatalog {
    public static let all: [Exercise] = entries.map { entry in
        Exercise(
            id: builtInID(slug: entry.slug),
            name: entry.name,
            primaryMuscle: entry.primary,
            secondaryMuscles: entry.secondary,
            equipment: entry.equipment,
            measurement: entry.measurement,
            isBuiltIn: true,
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    /// RFC 4122 version 5 (SHA-1, name-based) UUID in a namespace private to this app.
    public static func builtInID(slug: String) -> UUID {
        let namespace: [UInt8] = [0x6b, 0x1d, 0x3a, 0x52, 0x8c, 0x4e, 0x4f, 0x0a, 0x9a, 0x21, 0x5e, 0x7c, 0x10, 0x33, 0xd2, 0x48]
        var digest = Array(Insecure.SHA1.hash(data: namespace + Array(slug.utf8)).prefix(16))
        digest[6] = (digest[6] & 0x0F) | 0x50
        digest[8] = (digest[8] & 0x3F) | 0x80
        return UUID(uuid: (
            digest[0], digest[1], digest[2], digest[3], digest[4], digest[5], digest[6], digest[7],
            digest[8], digest[9], digest[10], digest[11], digest[12], digest[13], digest[14], digest[15]
        ))
    }

    struct Entry {
        let slug: String
        let name: String
        let primary: MuscleGroup
        let secondary: [MuscleGroup]
        let equipment: Equipment
        let measurement: ExerciseMeasurement
    }

    private static func e(
        _ slug: String, _ name: String, _ primary: MuscleGroup, _ secondary: [MuscleGroup],
        _ equipment: Equipment, _ measurement: ExerciseMeasurement
    ) -> Entry {
        Entry(slug: slug, name: name, primary: primary, secondary: secondary, equipment: equipment, measurement: measurement)
    }

    private static let total = ExerciseMeasurement.externalLoad(.total)
    private static let perHand = ExerciseMeasurement.externalLoad(.perHand)

    static let entries: [Entry] = [
        // Chest
        e("barbell-bench-press", "Bench Press (Barbell)", .chest, [.triceps, .shoulders], .barbell, total),
        e("incline-barbell-bench-press", "Incline Bench Press (Barbell)", .chest, [.shoulders, .triceps], .barbell, total),
        e("decline-barbell-bench-press", "Decline Bench Press (Barbell)", .chest, [.triceps], .barbell, total),
        e("dumbbell-bench-press", "Bench Press (Dumbbell)", .chest, [.triceps, .shoulders], .dumbbell, perHand),
        e("incline-dumbbell-bench-press", "Incline Bench Press (Dumbbell)", .chest, [.shoulders, .triceps], .dumbbell, perHand),
        e("dumbbell-fly", "Fly (Dumbbell)", .chest, [.shoulders], .dumbbell, perHand),
        e("cable-crossover", "Cable Crossover", .chest, [.shoulders], .cable, total),
        e("machine-chest-press", "Chest Press (Machine)", .chest, [.triceps], .machine, total),
        e("pec-deck", "Pec Deck (Machine)", .chest, [], .machine, total),
        e("push-up", "Push-up", .chest, [.triceps, .shoulders], .bodyweight, .bodyweight),
        e("chest-dip", "Dip", .chest, [.triceps, .shoulders], .bodyweight, .bodyweight),
        e("weighted-dip", "Dip (Weighted)", .chest, [.triceps, .shoulders], .bodyweight, .weightedBodyweight),
        e("assisted-dip", "Dip (Assisted)", .chest, [.triceps, .shoulders], .machine, .assistedBodyweight),
        // Back
        e("barbell-deadlift", "Deadlift (Barbell)", .back, [.hamstrings, .glutes], .barbell, total),
        e("barbell-row", "Bent Over Row (Barbell)", .back, [.biceps], .barbell, total),
        e("pendlay-row", "Pendlay Row (Barbell)", .back, [.biceps], .barbell, total),
        e("dumbbell-row", "One Arm Row (Dumbbell)", .back, [.biceps], .dumbbell, perHand),
        e("seated-cable-row", "Seated Row (Cable)", .back, [.biceps], .cable, total),
        e("lat-pulldown", "Lat Pulldown (Cable)", .back, [.biceps], .cable, total),
        e("machine-row", "Row (Machine)", .back, [.biceps], .machine, total),
        e("t-bar-row", "T-Bar Row", .back, [.biceps], .barbell, total),
        e("pull-up", "Pull-up", .back, [.biceps], .bodyweight, .bodyweight),
        e("weighted-pull-up", "Pull-up (Weighted)", .back, [.biceps], .bodyweight, .weightedBodyweight),
        e("assisted-pull-up", "Pull-up (Assisted)", .back, [.biceps], .machine, .assistedBodyweight),
        e("chin-up", "Chin-up", .back, [.biceps], .bodyweight, .bodyweight),
        e("weighted-chin-up", "Chin-up (Weighted)", .back, [.biceps], .bodyweight, .weightedBodyweight),
        e("back-extension", "Back Extension", .back, [.glutes, .hamstrings], .bodyweight, .bodyweight),
        e("face-pull", "Face Pull (Cable)", .shoulders, [.back], .cable, total),
        // Shoulders
        e("barbell-overhead-press", "Overhead Press (Barbell)", .shoulders, [.triceps], .barbell, total),
        e("dumbbell-shoulder-press", "Shoulder Press (Dumbbell)", .shoulders, [.triceps], .dumbbell, perHand),
        e("machine-shoulder-press", "Shoulder Press (Machine)", .shoulders, [.triceps], .machine, total),
        e("dumbbell-lateral-raise", "Lateral Raise (Dumbbell)", .shoulders, [], .dumbbell, perHand),
        e("cable-lateral-raise", "Lateral Raise (Cable)", .shoulders, [], .cable, total),
        e("reverse-fly", "Reverse Fly (Dumbbell)", .shoulders, [.back], .dumbbell, perHand),
        e("barbell-shrug", "Shrug (Barbell)", .back, [], .barbell, total),
        e("dumbbell-shrug", "Shrug (Dumbbell)", .back, [], .dumbbell, perHand),
        // Arms
        e("barbell-curl", "Bicep Curl (Barbell)", .biceps, [.forearms], .barbell, total),
        e("ez-bar-curl", "Bicep Curl (EZ Bar)", .biceps, [.forearms], .ezBar, total),
        e("dumbbell-curl", "Bicep Curl (Dumbbell)", .biceps, [.forearms], .dumbbell, perHand),
        e("hammer-curl", "Hammer Curl (Dumbbell)", .biceps, [.forearms], .dumbbell, perHand),
        e("preacher-curl", "Preacher Curl (EZ Bar)", .biceps, [], .ezBar, total),
        e("cable-curl", "Bicep Curl (Cable)", .biceps, [], .cable, total),
        e("triceps-pushdown", "Triceps Pushdown (Cable)", .triceps, [], .cable, total),
        e("overhead-triceps-extension-cable", "Overhead Triceps Extension (Cable)", .triceps, [], .cable, total),
        e("skull-crusher", "Skull Crusher (EZ Bar)", .triceps, [], .ezBar, total),
        e("close-grip-bench-press", "Close Grip Bench Press (Barbell)", .triceps, [.chest], .barbell, total),
        e("wrist-curl", "Wrist Curl (Dumbbell)", .forearms, [], .dumbbell, perHand),
        // Legs
        e("barbell-back-squat", "Squat (Barbell)", .quads, [.glutes, .hamstrings], .barbell, total),
        e("barbell-front-squat", "Front Squat (Barbell)", .quads, [.glutes, .core], .barbell, total),
        e("goblet-squat", "Goblet Squat (Dumbbell)", .quads, [.glutes], .dumbbell, total),
        e("leg-press", "Leg Press (Machine)", .quads, [.glutes], .machine, total),
        e("hack-squat", "Hack Squat (Machine)", .quads, [.glutes], .machine, total),
        e("leg-extension", "Leg Extension (Machine)", .quads, [], .machine, total),
        e("bulgarian-split-squat", "Bulgarian Split Squat (Dumbbell)", .quads, [.glutes], .dumbbell, perHand),
        e("dumbbell-lunge", "Lunge (Dumbbell)", .quads, [.glutes], .dumbbell, perHand),
        e("romanian-deadlift", "Romanian Deadlift (Barbell)", .hamstrings, [.glutes, .back], .barbell, total),
        e("dumbbell-romanian-deadlift", "Romanian Deadlift (Dumbbell)", .hamstrings, [.glutes], .dumbbell, perHand),
        e("lying-leg-curl", "Lying Leg Curl (Machine)", .hamstrings, [], .machine, total),
        e("seated-leg-curl", "Seated Leg Curl (Machine)", .hamstrings, [], .machine, total),
        e("barbell-hip-thrust", "Hip Thrust (Barbell)", .glutes, [.hamstrings], .barbell, total),
        e("sumo-deadlift", "Sumo Deadlift (Barbell)", .glutes, [.quads, .back], .barbell, total),
        e("hip-abduction", "Hip Abduction (Machine)", .glutes, [], .machine, total),
        e("standing-calf-raise", "Standing Calf Raise (Machine)", .calves, [], .machine, total),
        e("seated-calf-raise", "Seated Calf Raise (Machine)", .calves, [], .machine, total),
        // Core
        e("cable-crunch", "Crunch (Cable)", .core, [], .cable, total),
        e("hanging-leg-raise", "Hanging Leg Raise", .core, [], .bodyweight, .bodyweight),
        e("crunch", "Crunch", .core, [], .bodyweight, .bodyweight),
        e("ab-wheel-rollout", "Ab Wheel Rollout", .core, [], .other, .bodyweight),
        // Full body
        e("kettlebell-swing", "Kettlebell Swing", .fullBody, [.glutes, .hamstrings], .kettlebell, total),
        e("power-clean", "Power Clean (Barbell)", .fullBody, [.back, .quads], .barbell, total),
    ]
}
