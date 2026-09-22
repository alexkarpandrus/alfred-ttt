import Foundation
import FoundationModels

let note = CommandLine.arguments.dropFirst().joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
if note.isEmpty { Foundation.exit(0) }

guard case .available = SystemLanguageModel.default.availability else {
    FileHandle.standardError.write(Data("Apple Intelligence is unavailable.\n".utf8))
    Foundation.exit(2)
}

let stateSchema = DynamicGenerationSchema(
    name: "WorkState",
    anyOf: ["unchanged", "open", "active", "waiting", "completed", "canceled"]
)
let intentSchema = DynamicGenerationSchema(
    name: "WorkIntent",
    properties: [
        .init(
            name: "title",
            description: "A concise task-manager title with at most 12 words and no ending punctuation.",
            schema: DynamicGenerationSchema(type: String.self)
        ),
        .init(
            name: "state",
            description: "The explicit task state requested by the note, or unchanged when no state change is requested.",
            schema: stateSchema
        ),
    ]
)

let session = LanguageModelSession(instructions: """
    Interpret one raw work note without inventing details.
    Rewrite it as a concise task title. Start with an action verb only when the note requests an action.
    Keep factual progress notes factual. Preserve names, project identifiers, commitments, technical identifiers, and meaning.
    A state change must be explicit. Infer completed only from explicit completion, active only from explicit starting or work in progress,
    waiting only from explicit pausing or waiting on someone, open only from words such as reopen, resume, or unblock,
    and canceled only from explicit cancellation. A reply, status report, or other update alone is unchanged.
    Otherwise use unchanged.
    """)

do {
    let schema = try GenerationSchema(root: intentSchema, dependencies: [])
    let response = try await session.respond(
        to: note,
        schema: schema,
        options: GenerationOptions(temperature: 0.1)
    )
    print(response.content.jsonString)
} catch {
    FileHandle.standardError.write(Data("Could not infer work intent: \(error.localizedDescription)\n".utf8))
    Foundation.exit(1)
}
