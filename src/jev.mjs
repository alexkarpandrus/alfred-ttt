const API_URL = "https://api.typesafe.ai/v1/systemone";

export async function judgeTaskReport(note, task, options = {}) {
  const project = task.project?.displayId || task.project?.title;
  const questions = {
    same: {
      type: "noul",
      instructions: "Is this note a report that the task has been done, with no conflicting recipient, object, or project?",
    },
    action: {
      type: "choice",
      instructions: "Which action should follow from the note relative to this task?",
      criteria: {
        complete: "The task was done, and the note refers to the same person and object.",
        journal: "Just record the note; the task was not done or it names a different person or object.",
      },
    },
  };
  if (project) questions.project = {
    type: "choice",
    instructions: "Compare the raw work note with the candidate task project. A proper-named context after in, on, or for is a project/workspace context. A person after to is not a project. Choose different if the note explicitly names a different project/workspace, same if it names this project, and unspecified when it does not name a project context.",
    criteria: {
      different: "The note explicitly reports work in a different named project or workspace.",
      same: "The note explicitly reports work in the candidate task project.",
      unspecified: "The note omits a named project context; it may name a person or object.",
    },
  };
  const key = options.key ?? process.env.TYPESAFE_API_KEY;
  if (!key) throw new Error("Set the Jev API key in Alfred workflow configuration.");
  const response = await (options.fetch || fetch)(API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ state: { note, task: task.title, taskProject: project }, model: "jev-latest", questions }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Jev request failed (HTTP ${response.status}).`);
  const { answers } = await response.json();
  const same = answers?.same?.noul;
  const action = answers?.action;
  const relation = answers?.project;
  if (!Number.isFinite(same) || !["complete", "journal"].includes(action?.choice) ||
      !Number.isFinite(action.probabilities?.complete) ||
      (project && (!Number.isFinite(relation?.confidence) ||
        !["same", "different", "unspecified"].includes(relation.choice))))
    throw new Error("Jev returned an invalid task decision.");
  return action.choice === "complete" && action.probabilities.complete >= 0.9 &&
    same >= 0.7 && (!project || (relation.confidence >= 0.8 && relation.choice !== "different"));
}
