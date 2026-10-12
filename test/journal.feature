Feature: Native Logseq journal tasks
  The ll keyword uses an explicit Logseq file-graph profile.
  The ttt keyword keeps its own tracker profile.

  @acceptance @integration
  Scenario: Create one native TODO with the original note as a child comment
    Given a configured Logseq file-graph profile and a disposable graph
    When ll suggests TODO ask fixture teammate #test-tag
    Then the graph remains unchanged until approval
    When the user approves the displayed creation
    Then one native TODO exists with a persistent block UUID
    And the original note is a quoted native child comment
    And no Taskwarrior task or duplicate plain TODO is created

  @acceptance @integration
  Scenario: Complete only a verified native task
    Given Jev verifies an open Logseq task
    When the user approves completion
    Then the task and completion judgment are checked again
    And its native marker becomes DONE
    And the report is saved as a plain journal entry

  @acceptance @integration
  Scenario: Reject a changed graph or stale target without writing
    Given a pending native task approval
    When the graph, profile, task identity, title, project, or state changes
    Then the approval is rejected without task or journal writes

  @acceptance
  Scenario: Retain journal-only capture without an unverified completion
    Given no task profile or no scored verified match
    When ll receives an ordinary note
    Then it offers a plain journal entry without task changes
    And a missing task profile does not fall back to Taskwarrior

  @acceptance
  Scenario: Report partial success without inviting duplicate creation
    Given a native task creation or completion fails partway
    When the workflow reports the failure
    Then it advises inspection before retrying creation
    And successful completion followed by failed journal writing is reported explicitly
    And it does not instruct the user to repeat completion
