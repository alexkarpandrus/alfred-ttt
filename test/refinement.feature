Feature: Staged task suggestions
  Jev matches existing work while Apple Intelligence refines optional metadata.
  Background inference never applies a tracker mutation.

  Scenario: Create appears before Apple finishes and stays Create after Jev and Apple disagree
    Given a new-work request and an unrelated task about deprecating Patrol
    And Apple Intelligence has not finished
    When Alfred runs the script filter
    Then Create as written is actionable with no inferred metadata
    And Jev matches tasks in one grouped request
    When Apple Intelligence finishes
    Then the original Create action and selection ID stay unchanged
    And refined suggestions appear without applying a task change

  Scenario: Changing the query cancels obsolete refinement and never reuses its result
    Given background refinement for a previous query
    When the query or tracker profile changes
    Then the previous result is not shown for the new query
    And replacing the query cancels its background model request

  Scenario: Jev failure or delay cannot hold back Apple refinement
    Given Jev is unavailable or does not respond
    When Apple Intelligence finishes
    Then Alfred displays the local refined suggestions
    And Alfred stops polling

  Scenario: Completion and journal capture preserve their verification path
    Given a progress report, an explicit task target, or the ll keyword
    When Alfred runs the script filter
    Then staged refinement is not used
    And the existing completion checks still determine whether Complete is offered


  Scenario: Apple refinement preserves explicit priority, due date, tags, and the raw note
    Given a capture request with high priority, an explicit tag, and a relative due date
    When Apple Intelligence finishes
    Then a refined Create suggestion includes that metadata
    And the original Create as written action remains unchanged

  Scenario: Semantic lookup stays read-only when Apple proposes an unrelated target
    Given Jev selects the relevant task
    When Apple Intelligence selects an unrelated task instead
    Then the Jev-selected task and its selection ID remain unchanged
    And no mutation is offered

  Scenario: Switching to the dashboard cancels pending background inference
    Given an unfinished task refinement
    When the user switches to the summary command
    Then the dashboard opens without staged polling
    And the obsolete model request is canceled

  Scenario: Jev can still find work when Apple Intelligence is unavailable
    Given Apple Intelligence returns no interpretation
    When Jev finds the requested task
    Then Alfred displays the matching task read-only
    And Alfred stops polling

  Scenario: An unresolved lookup cannot become a mutation when both models are unavailable
    Given neither model can interpret a lookup
    When background refinement finishes
    Then Alfred shows an unavailable result without an actionable mutation
    And Alfred stops polling
  @acceptance
  Scenario: A get-into work request creates a task instead of browsing referenced tickets
    Given the note "get the handover ownership list into P-TT-442, and move TT-969 into P-TT-439"
    When Jev and Apple both classify it as a lookup
    Then Create as written appears first and remains unchanged after refinement
    And all three ticket references and both clauses remain in the title and comment
    And no ticket is created or moved without approval
    And ordinary get lookups and questions remain read-only
