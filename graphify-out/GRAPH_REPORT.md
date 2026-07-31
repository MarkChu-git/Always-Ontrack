# Graph Report - ontrack-cli  (2026-07-31)

## Corpus Check
- 76 files · ~82,336 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 884 nodes · 2373 edges · 54 communities (51 shown, 3 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 13 edges (avg confidence: 0.78)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `6ca7c78a`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Package Manifest Metadata
- Repository Metadata
- CLI Binary Entrypoints
- NPM Script Definitions
- TypeScript Development Dependencies
- Package Keywords
- Runtime Dependencies
- Coverage Enforcement
- Skill Lock Verification
- Real Environment Smoke Tests
- Package Integrity Verification
- Auth MCP Server
- CLI Terminal Interface
- Welcome Login Menu
- Task Utility Helpers
- CLI Command Handlers
- OnTrack API Client
- Agent Command Specifications
- Student Task View
- Agent Protocol Schema
- Structured Command Input
- API Endpoint Discovery
- Auto Login Tests
- Auth Broker Service
- Auth Runtime Lifecycle
- Core Domain Types
- Okta MFA Auto Login
- Browser Launch Capture
- Credential Extraction
- SSO Credential Capture
- Guided SSO Page Automation
- MFA Number Challenge Parsing
- Contract Drift Validation
- Execution Journal
- Task Planner Models
- Session Lock Management
- Task Summary Models
- Shared Utility Helpers
- Submission Lifecycle
- Identity Output Redaction
- Skill Lock Tests
- Workflow Security Tests
- TypeScript Configuration
- CI CD Release Automation
- Auth Architecture Documentation
- Domain Model Documentation
- Planner Semantics Documentation
- Contract Provenance Documentation
- Agent First Documentation
- Lightpanda Auth Experiment

## God Nodes (most connected - your core abstractions)
1. `SessionData` - 46 edges
2. `printJson()` - 33 edges
3. `handleSubmissionUpload()` - 32 edges
4. `main()` - 32 edges
5. `hasFlag()` - 31 edges
6. `OnTrackApiClient` - 29 edges
7. `requireSession()` - 28 edges
8. `printTable()` - 27 edges
9. `handleLogin()` - 26 edges
10. `createAuthenticatedApi()` - 24 edges

## Surprising Connections (you probably didn't know these)
- `Agent Protocol` --semantically_similar_to--> `Agent-First Architecture`  [INFERRED] [semantically similar]
  README.md → docs/AGENT_READY_IMPLEMENTATION_PLAN.md
- `buildStudentTaskViews()` --calls--> `submissionTask()`  [EXTRACTED]
  src/lib/student-task-view.ts → test/submission-lifecycle.test.ts
- `Dependabot Dependency Updates` --implements--> `CI/CD Pipeline`  [INFERRED]
  .github/dependabot.yml → docs/CI_CD_DESIGN.md
- `bun` --references--> `run()`  [EXTRACTED]
  package.json → scripts/verify-package.ts
- `createAuthMcpServer()` --calls--> `withClient()`  [EXTRACTED]
  src/auth-mcp-server.ts → test/auth-mcp.test.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Five Deep Module Refactor** — docs_architecture_refactor_plan_auth_module, docs_architecture_refactor_plan_task_aggregation_module, docs_architecture_refactor_plan_submission_module, docs_architecture_refactor_plan_planner_module, docs_architecture_refactor_plan_contract_module [EXTRACTED 1.00]
- **Verified Release Artifact Chain** — github_workflows_ci_ci_pipeline, github_workflows_release_release_pipeline, docs_ci_cd_design_ci_cd_pipeline, docs_release_runbook_release_procedure [EXTRACTED 1.00]

## Communities (54 total, 3 thin omitted)

### Community 15 - "Package Manifest Metadata"
Cohesion: 0.12
Nodes (15): name, version, description, license, bugs, url, homepage, publishConfig (+7 more)

### Community 39 - "Repository Metadata"
Cohesion: 0.67
Nodes (3): repository, type, url

### Community 53 - "CLI Binary Entrypoints"
Cohesion: 0.67
Nodes (3): bin, ontrack, ontrack-auth-mcp

### Community 26 - "NPM Script Definitions"
Cohesion: 0.14
Nodes (14): scripts, build, dev, test, test:coverage, typecheck, smoke:real, graphify:setup (+6 more)

### Community 34 - "TypeScript Development Dependencies"
Cohesion: 0.40
Nodes (5): devDependencies, @types/node, @types/node, typescript, typescript

### Community 31 - "Package Keywords"
Cohesion: 0.33
Nodes (6): keywords, ontrack, doubtfire, cli, agent, mcp

### Community 30 - "Runtime Dependencies"
Cohesion: 0.29
Nodes (7): dependencies, @modelcontextprotocol/sdk, @modelcontextprotocol/sdk, playwright-core, playwright-core, zod, zod

### Community 12 - "Coverage Enforcement"
Cohesion: 0.22
Nodes (15): CoverageMetric, CoverageSummary, CoverageThresholds, CoverageEvaluation, toPercentage(), toMetric(), toMetricFromCounts(), parseLineHit() (+7 more)

### Community 51 - "Skill Lock Verification"
Cohesion: 0.31
Nodes (9): SkillLockEntry, SkillLock, HashedFile, isRecord(), parseLock(), collectFiles(), computeSkillFolderHash(), listInstalledSkillNames() (+1 more)

### Community 28 - "Real Environment Smoke Tests"
Cohesion: 0.50
Nodes (7): parseArgs(), run(), runJson(), runWatch(), runFeedbackWatch(), pickFirstTask(), main()

### Community 18 - "Package Integrity Verification"
Cohesion: 0.26
Nodes (12): requiredEntries, PackageVerification, isSafeEntry(), isAllowedEntry(), validateTarEntries(), validateTarEntryTypes(), run(), assertChildPath() (+4 more)

### Community 13 - "Auth MCP Server"
Cohesion: 0.19
Nodes (11): nextActionSchema, toolResultSchema, ToolResult, AuthMcpDependencies, defaultDependencies(), toolResponse(), configuredBaseUrl(), createAuthMcpServer() (+3 more)

### Community 0 - "CLI Terminal Interface"
Cohesion: 0.07
Nodes (51): InboxRowTask, DIGITAL_LOGO_LINES, LOGO_COLOR_CODES, launcherColorsEnabled(), launcherColor(), formatWelcomeMenuRow(), renderWelcomeScreen(), TerminalPanelTone (+43 more)

### Community 38 - "Welcome Login Menu"
Cohesion: 0.12
Nodes (26): sessionFromAccessTokenCapture(), help(), panelVisibleLength(), panelToneCode(), panelBodyCode(), renderTerminalPanel(), optionalFlagArgs(), promptRequired() (+18 more)

### Community 19 - "Task Utility Helpers"
Cohesion: 0.19
Nodes (31): promptTaskSelectorFromTaskList(), flattenTasks(), loadProjectsWithTaskMetadata(), buildInboxFallbackTasksFromProjectDetails(), handleUnitTasks(), handleTasks(), handleInbox(), handleTaskShow() (+23 more)

### Community 8 - "CLI Command Handlers"
Cohesion: 0.20
Nodes (37): requireSession(), createAuthenticatedApi(), taskIdentityJson(), parseOptionalInteger(), handleAuthMethod(), handleSchema(), handleAuthStatus(), handleAuthEnsure() (+29 more)

### Community 1 - "OnTrack API Client"
Cohesion: 0.15
Nodes (27): isForbiddenError(), listUnitsWithFallback(), handleDoctor(), JsonBody, RETRYABLE_STATUSES, AuthSessionRefresh, isReplaySafe(), withRefreshedAuth() (+19 more)

### Community 6 - "Agent Command Specifications"
Cohesion: 0.11
Nodes (17): readCliVersion(), handleCapabilities(), AgentCommandRisk, CommandInputType, CommandInputField, AgentCommandSpec, jsonSchemaForFields(), spec() (+9 more)

### Community 45 - "Student Task View"
Cohesion: 0.16
Nodes (25): resolveSelectedStudentTask(), StudentTaskVisibility, StudentTaskDates, BuildStudentTaskViewOptions, StudentTaskViewSelector, recordValue(), integerValue(), stringValue() (+17 more)

### Community 4 - "Agent Protocol Schema"
Cohesion: 0.14
Nodes (20): AGENT_SCHEMA_VERSION, AgentStatus, AgentErrorCode, AgentNextAction, AgentArtifact, agentSuccessEnvelope, AgentFailureEnvelope, isCredentialKey() (+12 more)

### Community 47 - "Structured Command Input"
Cohesion: 0.17
Nodes (14): AgentProtocolError, UNSAFE_KEYS, AGENT_GLOBAL_FLAGS, GROUPED_AGENT_COMMANDS, StructuredInputError, StructuredInputDependencies, readFlagValue(), removeFlagPair() (+6 more)

### Community 9 - "API Endpoint Discovery"
Cohesion: 0.13
Nodes (21): ProbeResult, API_HINTS, DiscoveryAsset, DiscoveryResult, ProbeItem, ProbeApiClient, normalizePath(), isApiTemplate() (+13 more)

### Community 10 - "Auto Login Tests"
Cohesion: 0.18
Nodes (17): SsoFallbackError, candidateBrowserPaths(), resolveBrowserLaunchPlan(), classifySsoFallback(), resolveBrowserSessionStatePath(), clearBrowserSessionState(), resolveSystemBrowserUserDataDirs(), isSystemBrowserProfileReuseEnabled() (+9 more)

### Community 14 - "Auth Broker Service"
Cohesion: 0.18
Nodes (12): OnTrackAuthBrokerOptions, OnTrackAuthBrokerDependencies, AuthStatusView, defaultDependencies(), sessionFromCapture(), createOnTrackAuthBroker(), createSessionFromAccessToken(), LoginCredentials (+4 more)

### Community 16 - "Auth Runtime Lifecycle"
Cohesion: 0.16
Nodes (12): AuthInteractionMode, AuthEnsureOptions, AuthRuntimeResult, AuthRuntimeAdapter, AuthRuntime, isFreshEnough(), ready(), credentialVersionChanged() (+4 more)

### Community 49 - "Core Domain Types"
Cohesion: 0.16
Nodes (12): AuthFailureKind, OnTrackHttpError, classifyAuthFailure(), migrateLegacySession(), OnTrackUser, AccessTokenResponse, CredentialSource, TaskBatchSelector (+4 more)

### Community 7 - "Okta MFA Auto Login"
Cohesion: 0.08
Nodes (33): SsoLoginOptions, MfaMethodOption, SsoStep, SsoFallbackReason, BrowserLaunchPlan, BrowserStorageEntry, BrowserStorageState, SaveBrowserSessionStateOptions (+25 more)

### Community 23 - "Browser Launch Capture"
Cohesion: 0.15
Nodes (10): BrowserLaunchAdapter, browserInstallHint(), isMissingDisplayServerError(), isMissingSharedLibraryError(), asErrorMessage(), launchBrowserForCapture(), captureSsoCredentials(), captureSsoCredentialsWithGuidedLogin() (+2 more)

### Community 21 - "Credential Extraction"
Cohesion: 0.29
Nodes (12): hasValue(), extractCredentialsFromAuthPayload(), tryParseJson(), extractCredentialsFromUnknownObject(), normalizeStorageStringValue(), extractUsernameFromUserRecord(), extractCredentialsFromStorageEntries(), SystemBrowserProfileLocation (+4 more)

### Community 25 - "SSO Credential Capture"
Cohesion: 0.20
Nodes (15): isTargetOnTrackUrl(), isTargetOnTrackAuthUrl(), extractCredentialsFromUrl(), extractCredentialsFromCookieJar(), extractCredentialsFromRequestHeaders(), extractCredentialsFromLocalStorage(), summarizePageLocations(), collectScopes() (+7 more)

### Community 20 - "Guided SSO Page Automation"
Cohesion: 0.29
Nodes (12): BLOCKED_LINK_HOSTS, InteractionScope, canUseSelector(), fillFirstVisible(), clickLikelyActionControl(), isSafeActionLink(), clickFirstVisible(), hasAnySelectorInScopes() (+4 more)

### Community 35 - "MFA Number Challenge Parsing"
Cohesion: 0.50
Nodes (5): uniqueInOrder(), extractNumberTokens(), hasMfaChallengeSignal(), extractMfaNumberChallengeFromText(), extractMfaNumberChallenge()

### Community 5 - "Contract Drift Validation"
Cohesion: 0.10
Nodes (39): ContractTrust, ContractRisk, ContractProvenance, ContractFixtureMetadata, ContractShape, ContractFixture, FixtureValidationResult, NormalizedReadOnlyRoute (+31 more)

### Community 48 - "Execution Journal"
Cohesion: 0.25
Nodes (17): ExecutionState, ExecutionRecord, ExecutionClaim, ExecutionJournalOptions, configRoot(), journalRoot(), digest(), stableValue() (+9 more)

### Community 2 - "Task Planner Models"
Cohesion: 0.14
Nodes (23): PlanDateSource, PlanDateKind, PlanDateValue, PlannerPrerequisite, PlannerView, RawTaskPrerequisite, PlanDateChange, PlannerMutation (+15 more)

### Community 11 - "Session Lock Management"
Cohesion: 0.17
Nodes (16): getConfigRoot(), getSessionPath(), SessionPathOptions, SessionRefreshLockOptions, SessionLockOwner, resolveSessionPath(), resolveSessionRefreshLockPath(), wait() (+8 more)

### Community 50 - "Task Summary Models"
Cohesion: 0.50
Nodes (4): StudentTaskView, TaskDefinitionSummary, TaskSummary, InboxTask

### Community 3 - "Shared Utility Helpers"
Cohesion: 0.07
Nodes (46): StudentTaskRow, TaskSelector, parseSsoRedirectUrl(), shouldMaskPromptInput(), promptHidden(), isFlag(), getFlagValues(), toDisplayValue() (+38 more)

### Community 46 - "Submission Lifecycle"
Cohesion: 0.14
Nodes (24): SubmissionPdfState, SubmissionDetails, SubmissionFileInput, PreparedSubmissionFile, SubmissionAttemptState, SubmissionJournalEntry, SubmissionAttempt, SubmissionAttemptEvent (+16 more)

### Community 24 - "Identity Output Redaction"
Cohesion: 0.29
Nodes (8): WhoAmIView, toWhoAmIView(), stringValue(), nonBlankStringValue(), numberValue(), secretValues, makeSession(), runCliWhoAmI()

### Community 17 - "TypeScript Configuration"
Cohesion: 0.14
Nodes (13): compilerOptions, target, module, moduleResolution, outDir, rootDir, strict, noEmitOnError (+5 more)

### Community 27 - "CI CD Release Automation"
Cohesion: 0.36
Nodes (8): Dependabot Dependency Updates, CI Workflow, Dependency Review Workflow, Release Workflow, CI/CD Pipeline, Coverage Ratchet, Protected Release Environment, Release Procedure

### Community 29 - "Auth Architecture Documentation"
Cohesion: 0.29
Nodes (7): Security Identity, Credential, Auth Lifecycle, Auth Runtime, Five Deep Modules, Auth Lifecycle and Security Identity Module, Production Model Change

### Community 22 - "Domain Model Documentation"
Cohesion: 0.22
Nodes (11): Task Definition, Task Instance, Student Task View, Task Reference, Submission Attempt, Evidence Slot, Unknown Outcome, Safe Agent Writes (+3 more)

### Community 37 - "Planner Semantics Documentation"
Cohesion: 0.67
Nodes (3): Plan Date, Task Planner and Date Semantics Module, Task Planner

### Community 36 - "Contract Provenance Documentation"
Cohesion: 0.67
Nodes (4): Observed Contract, Contract Fixture, Contract Drift, Production Contract Discovery and Fixture Module

### Community 33 - "Agent First Documentation"
Cohesion: 0.40
Nodes (5): Agent Protocol, Authentication MCP, Chinese Documentation, Agent-First Architecture, Structured Human Handoff

## Knowledge Gaps
- **188 isolated node(s):** `name`, `version`, `description`, `license`, `type` (+183 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `SessionData` connect `OnTrack API Client` to `CLI Terminal Interface`, `API Endpoint Discovery`, `Session Lock Management`, `Auth MCP Server`, `Auth Broker Service`, `Auth Runtime Lifecycle`, `Core Domain Types`, `Identity Output Redaction`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Why does `OnTrackApiClient` connect `OnTrack API Client` to `CLI Terminal Interface`, `Core Domain Types`, `Auto Login Tests`, `Auth Broker Service`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Why does `createOnTrackAuthBroker()` connect `Auth Broker Service` to `CLI Terminal Interface`, `CLI Command Handlers`, `Auth MCP Server`, `Auth Runtime Lifecycle`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _188 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Package Manifest Metadata` be split into smaller, more focused modules?**
  _Cohesion score 0.125 - nodes in this community are weakly interconnected._
- **Should `NPM Script Definitions` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._
- **Should `CLI Terminal Interface` be split into smaller, more focused modules?**
  _Cohesion score 0.07039187227866474 - nodes in this community are weakly interconnected._