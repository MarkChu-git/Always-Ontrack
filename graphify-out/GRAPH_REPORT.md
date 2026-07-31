# Graph Report - ontrack-fix-slow-signin.1J4byP  (2026-07-31)

## Corpus Check
- 75 files · ~86,901 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 936 nodes · 2462 edges · 58 communities (55 shown, 3 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 13 edges (avg confidence: 0.78)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `8ce7ac41`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- student-task-view.ts
- SessionData
- planner.ts
- utils.ts
- agent-protocol.ts
- Contract Drift Validation
- command-spec.ts
- auto-login.ts
- cli.ts
- discovery.ts
- auto-login.test.ts
- session.ts
- Coverage Enforcement
- auth-mcp-server.ts
- auth-broker.ts
- package.json
- auth-runtime.ts
- TypeScript Configuration
- verify-package.ts
- types.ts
- advanceGuidedSsoOnPage
- extractCredentialsFromStorageEntries
- Domain Model Documentation
- launchBrowserForCapture
- Identity Output Redaction
- auto-login-session-reuse.test.ts
- scripts
- CI CD Release Automation
- Real Environment Smoke Tests
- Auth Architecture Documentation
- Runtime Dependencies
- Package Keywords
- Agent First Documentation
- devDependencies
- MFA Number Challenge Parsing
- Contract Provenance Documentation
- Planner Semantics Documentation
- buildContextOptionsWithStoredSession
- Repository Metadata
- Workflow Security Tests
- Lightpanda Auth Experiment
- handleSubmissionUpload
- captureSsoCredentialsInternal
- OnTrackAuthBroker
- printJson
- check-gitnexus-skill-sync.ts
- overrides
- Skill Lock Verification
- Skill Lock Tests
- CLI Binary Entrypoints
- utils-coverage.test.ts
- runWelcomeAction
- ProjectSummary
- check-gitnexus-mcp.ts

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
10. `scripts` - 25 edges

## Surprising Connections (you probably didn't know these)
- `Agent-First Architecture` --semantically_similar_to--> `Agent Protocol`  [INFERRED] [semantically similar]
  docs/AGENT_READY_IMPLEMENTATION_PLAN.md → README.md
- `submissionTask()` --calls--> `buildStudentTaskViews()`  [EXTRACTED]
  test/submission-lifecycle.test.ts → src/lib/student-task-view.ts
- `Dependabot Dependency Updates` --implements--> `CI/CD Pipeline`  [INFERRED]
  .github/dependabot.yml → docs/CI_CD_DESIGN.md
- `withClient()` --references--> `client`  [EXTRACTED]
  test/auth-mcp.test.ts → scripts/check-gitnexus-mcp.ts
- `CI Workflow` --implements--> `Coverage Ratchet`  [INFERRED]
  .github/workflows/ci.yml → docs/CI_CD_DESIGN.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Five Deep Module Refactor** — docs_architecture_refactor_plan_auth_module, docs_architecture_refactor_plan_task_aggregation_module, docs_architecture_refactor_plan_submission_module, docs_architecture_refactor_plan_planner_module, docs_architecture_refactor_plan_contract_module [EXTRACTED 1.00]
- **Verified Release Artifact Chain** — github_workflows_ci_ci_pipeline, github_workflows_release_release_pipeline, docs_ci_cd_design_ci_cd_pipeline, docs_release_runbook_release_procedure [EXTRACTED 1.00]

## Communities (58 total, 3 thin omitted)

### Community 0 - "student-task-view.ts"
Cohesion: 0.16
Nodes (24): resolveSelectedStudentTask(), buildStudentTaskRows(), BuildStudentTaskViewOptions, buildStudentTaskViews(), definitionsForProject(), definitionTargetGrade(), definitionTutorialStream(), embeddedDefinition() (+16 more)

### Community 1 - "SessionData"
Cohesion: 0.17
Nodes (24): handleDoctor(), authHeaders(), AuthSessionRefresh, buildErrorMessage(), DownloadResult, isReplaySafe(), JsonBody, methodOf() (+16 more)

### Community 2 - "planner.ts"
Cohesion: 0.15
Nodes (21): buildPlannerViews(), dateFrom(), defaultDate(), gradeDateRow(), integerValue(), personalDate(), PlanDateChange, PlanDateKind (+13 more)

### Community 3 - "utils.ts"
Cohesion: 0.08
Nodes (42): FeedbackItem, buildPdfFilename(), colorize(), COLORS_ENABLED, DEFAULT_DOWNLOAD_DIR, diffWatchStates(), feedbackIdentity(), feedbackIdValue() (+34 more)

### Community 4 - "agent-protocol.ts"
Cohesion: 0.08
Nodes (47): claimConfirmedWrite(), handlePlanCommand(), handlePlanReset(), handlePlanSetDates(), isDefinitiveWriteRejection(), loadPlannerContext(), plannerReadback(), recordUnknownWrite() (+39 more)

### Community 5 - "Contract Drift Validation"
Cohesion: 0.10
Nodes (39): canonicalRoute(), collectShapeDrift(), collectUnexpectedKeys(), collectUnsafePayload(), collectUnsafeShapeEnums(), ContractDrift, ContractFixture, ContractFixtureMetadata (+31 more)

### Community 6 - "command-spec.ts"
Cohesion: 0.08
Nodes (29): AgentProtocolError, AGENT_GLOBAL_FLAGS, encodeField(), flagOccurrences(), GROUPED_AGENT_COMMANDS, mergeStructuredCommandInput(), parseObject(), readFlagValue() (+21 more)

### Community 7 - "auto-login.ts"
Cohesion: 0.07
Nodes (35): BrowserLaunchPlan, BrowserStorageEntry, BrowserStorageState, ClaimedBrowserSessionState, clickDetectedMfaOption(), collectKnownMfaMethodOptions(), collectMfaSelectionOptions(), collectSelectControls() (+27 more)

### Community 8 - "cli.ts"
Cohesion: 0.07
Nodes (49): applyLimit(), arrayLength(), countTasksByStatus(), dedupeInboxTasks(), deriveDefaultSubmissionTrigger(), deriveUnitsFromProjects(), describeWatchEvent(), DIGITAL_LOGO_LINES (+41 more)

### Community 9 - "discovery.ts"
Cohesion: 0.13
Nodes (21): ProbeResult, API_HINTS, classifyDiscoveredPaths(), discoverOnTrackSurface(), DiscoveryAsset, DiscoveryResult, extractDiscoveredPaths(), extractJavascriptAssetPaths() (+13 more)

### Community 10 - "auto-login.test.ts"
Cohesion: 0.21
Nodes (11): candidateBrowserPaths(), captureCredentialsFromStoredBrowserSession(), captureCredentialsFromSystemBrowserProfile(), classifySsoFallback(), expandSystemBrowserProfileCandidates(), isLikelyChromiumProfileDir(), isSystemBrowserProfileReuseEnabled(), resolveBrowserLaunchPlan() (+3 more)

### Community 11 - "session.ts"
Cohesion: 0.21
Nodes (14): AcquiredSessionRefreshLock, acquireSessionRefreshLock(), clearSession(), getConfigRoot(), getSessionPath(), isNodeError(), recoverStaleRefreshLock(), resolveSessionPath() (+6 more)

### Community 12 - "Coverage Enforcement"
Cohesion: 0.22
Nodes (15): assertThreshold(), checkCoverage(), CoverageEvaluation, CoverageMetric, CoverageSummary, CoverageThresholds, evaluateCoverage(), formatMetric() (+7 more)

### Community 13 - "auth-mcp-server.ts"
Cohesion: 0.20
Nodes (12): AuthMcpDependencies, configuredBaseUrl(), createAuthMcpServer(), defaultDependencies(), nextActionSchema, serveAuthMcp(), toolResponse(), ToolResult (+4 more)

### Community 14 - "auth-broker.ts"
Cohesion: 0.17
Nodes (14): AuthStatusView, createOnTrackAuthBroker(), defaultDependencies(), OnTrackAuthBrokerDependencies, OnTrackAuthBrokerOptions, sessionFromCapture(), AutoLoginOptions, captureSsoCredentials() (+6 more)

### Community 15 - "package.json"
Cohesion: 0.12
Nodes (15): bugs, url, description, files, homepage, license, name, packageManager (+7 more)

### Community 16 - "auth-runtime.ts"
Cohesion: 0.14
Nodes (14): AuthInteractionMode, authRequired(), AuthRuntime, AuthRuntimeAdapter, createAuthRuntime(), credentialVersionChanged(), inFlightKey(), isFreshEnough() (+6 more)

### Community 17 - "TypeScript Configuration"
Cohesion: 0.14
Nodes (13): src/**/*.ts, compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution, noEmitOnError, outDir (+5 more)

### Community 18 - "verify-package.ts"
Cohesion: 0.22
Nodes (14): engines, bun, assertChildPath(), assertRegularTree(), isAllowedEntry(), isSafeEntry(), main(), PackageVerification (+6 more)

### Community 19 - "types.ts"
Cohesion: 0.13
Nodes (16): AuthFailureKind, classifyAuthFailure(), createSessionFromAccessToken(), migrateLegacySession(), OnTrackHttpError, AccessTokenResponse, CredentialSource, InboxTask (+8 more)

### Community 20 - "advanceGuidedSsoOnPage"
Cohesion: 0.26
Nodes (13): advanceGuidedSsoOnPage(), BLOCKED_LINK_HOSTS, canUseSelector(), clickFirstVisible(), clickLikelyActionControl(), collectScopes(), fillFirstVisible(), fillMfaCodeInputs() (+5 more)

### Community 21 - "extractCredentialsFromStorageEntries"
Cohesion: 0.26
Nodes (12): extractCredentialsFromAuthPayload(), extractCredentialsFromStorageEntries(), extractCredentialsFromUnknownObject(), extractCredentialsFromUrl(), extractUsernameFromUserRecord(), hasValue(), isBrowserStorageCookie(), isBrowserStorageOrigin() (+4 more)

### Community 22 - "Domain Model Documentation"
Cohesion: 0.22
Nodes (11): Evidence Slot, Student Task View, Submission Attempt, Task Definition, Task Instance, Task Reference, Unknown Outcome, Submission Lifecycle Module (+3 more)

### Community 23 - "launchBrowserForCapture"
Cohesion: 0.17
Nodes (9): asErrorMessage(), browserInstallHint(), BrowserLaunchAdapter, captureSsoCredentialsWithGuidedLogin(), isMissingDisplayServerError(), isMissingSharedLibraryError(), launchBrowserForCapture(), FakeBrowserOptions (+1 more)

### Community 24 - "Identity Output Redaction"
Cohesion: 0.29
Nodes (8): nonBlankStringValue(), numberValue(), stringValue(), toWhoAmIView(), WhoAmIView, makeSession(), runCliWhoAmI(), secretValues

### Community 25 - "auto-login-session-reuse.test.ts"
Cohesion: 0.40
Nodes (3): setBrowserSessionStatePathForTests(), browserStateEnvironmentTail, withBrowserState()

### Community 26 - "scripts"
Cohesion: 0.08
Nodes (25): scripts, build, clean, dev, gitnexus:analyze, gitnexus:check, gitnexus:context, gitnexus:detect-changes (+17 more)

### Community 27 - "CI CD Release Automation"
Cohesion: 0.36
Nodes (8): CI/CD Pipeline, Coverage Ratchet, Protected Release Environment, Release Procedure, Dependabot Dependency Updates, CI Workflow, Dependency Review Workflow, Release Workflow

### Community 28 - "Real Environment Smoke Tests"
Cohesion: 0.50
Nodes (7): main(), parseArgs(), pickFirstTask(), run(), runFeedbackWatch(), runJson(), runWatch()

### Community 29 - "Auth Architecture Documentation"
Cohesion: 0.29
Nodes (7): Auth Lifecycle, Credential, Security Identity, Auth Runtime, Auth Lifecycle and Security Identity Module, Five Deep Modules, Production Model Change

### Community 30 - "Runtime Dependencies"
Cohesion: 0.29
Nodes (7): @modelcontextprotocol/sdk, dependencies, @modelcontextprotocol/sdk, playwright-core, zod, playwright-core, zod

### Community 31 - "Package Keywords"
Cohesion: 0.33
Nodes (6): keywords, agent, cli, doubtfire, mcp, ontrack

### Community 33 - "Agent First Documentation"
Cohesion: 0.40
Nodes (5): Agent-First Architecture, Structured Human Handoff, Agent Protocol, Authentication MCP, Chinese Documentation

### Community 34 - "devDependencies"
Cohesion: 0.29
Nodes (7): gitnexus, devDependencies, gitnexus, @types/node, typescript, @types/node, typescript

### Community 35 - "MFA Number Challenge Parsing"
Cohesion: 0.50
Nodes (5): extractMfaNumberChallenge(), extractMfaNumberChallengeFromText(), extractNumberTokens(), hasMfaChallengeSignal(), uniqueInOrder()

### Community 36 - "Contract Provenance Documentation"
Cohesion: 0.67
Nodes (4): Contract Drift, Contract Fixture, Observed Contract, Production Contract Discovery and Fixture Module

### Community 37 - "Planner Semantics Documentation"
Cohesion: 0.67
Nodes (3): Plan Date, Task Planner and Date Semantics Module, Task Planner

### Community 38 - "buildContextOptionsWithStoredSession"
Cohesion: 0.29
Nodes (16): assertTrustedBrowserSessionStateDirectory(), buildContextOptionsWithStoredSession(), captureCredentialsFromPersistedStateFile(), claimBrowserSessionState(), filterBrowserSessionState(), hasReusableBrowserSessionState(), isBrowserStorageState(), publishCapturedBrowserSessionState() (+8 more)

### Community 39 - "Repository Metadata"
Cohesion: 0.67
Nodes (3): repository, type, url

### Community 45 - "handleSubmissionUpload"
Cohesion: 0.13
Nodes (26): handleSubmissionUpload(), parseSubmissionTrigger(), readUploadFiles(), booleanValue(), createSubmissionAttempt(), isSubmissionObserved(), journalEntry(), parseSubmissionDetails() (+18 more)

### Community 46 - "captureSsoCredentialsInternal"
Cohesion: 0.23
Nodes (13): canUseSelectorInScopes(), captureSsoCredentialsInternal(), detectOktaVerifyChallenge(), detectSsoCaptcha(), detectUnsupportedMfa(), extractCredentialsFromCookieJar(), extractCredentialsFromLocalStorage(), extractCredentialsFromRequestHeaders() (+5 more)

### Community 47 - "OnTrackAuthBroker"
Cohesion: 0.33
Nodes (3): OnTrackAuthBroker, AuthEnsureOptions, AuthRuntimeResult

### Community 48 - "printJson"
Cohesion: 0.18
Nodes (40): createAuthenticatedApi(), handleAuthEnsure(), handleAuthMethod(), handleAuthStatus(), handleDiscover(), handleFeedbackCommand(), handleFeedbackList(), handleFeedbackWatch() (+32 more)

### Community 49 - "check-gitnexus-skill-sync.ts"
Cohesion: 0.50
Nodes (3): packageRecord, packageValue, root

### Community 50 - "overrides"
Cohesion: 0.67
Nodes (3): overrides, adm-zip, sharp

### Community 51 - "Skill Lock Verification"
Cohesion: 0.31
Nodes (9): collectFiles(), computeSkillFolderHash(), HashedFile, isRecord(), listInstalledSkillNames(), main(), parseLock(), SkillLock (+1 more)

### Community 53 - "CLI Binary Entrypoints"
Cohesion: 0.67
Nodes (3): bin, ontrack, ontrack-auth-mcp

### Community 54 - "utils-coverage.test.ts"
Cohesion: 0.20
Nodes (30): buildInboxFallbackTasksFromProjectDetails(), buildWatchSnapshot(), filterProjectsForWatch(), flattenTasks(), handleInbox(), handleTasks(), handleTaskShow(), handleUnitTasks() (+22 more)

### Community 55 - "runWelcomeAction"
Cohesion: 0.17
Nodes (19): buildTaskSelectorArgs(), expandHomePath(), handleWelcome(), help(), optionalFlagArgs(), parseTaskSelectorTokens(), promptGuidedOutputDirectory(), promptGuidedTaskSelector() (+11 more)

### Community 56 - "ProjectSummary"
Cohesion: 0.22
Nodes (8): buildResetTargetDatesMutation(), buildTargetDateMutation(), parseDateOnly(), validatePlanDateChange(), StudentTaskRow, ProjectSummary, TaskSelector, ResolvedTaskSelector

### Community 57 - "check-gitnexus-mcp.ts"
Cohesion: 0.33
Nodes (3): client, expectedTools, transport

## Knowledge Gaps
- **211 isolated node(s):** `name`, `version`, `description`, `license`, `type` (+206 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `SessionData` connect `SessionData` to `cli.ts`, `discovery.ts`, `session.ts`, `auth-broker.ts`, `OnTrackAuthBroker`, `auth-runtime.ts`, `types.ts`, `Identity Output Redaction`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Why does `OnTrackApiClient` connect `SessionData` to `cli.ts`, `auto-login.test.ts`, `types.ts`, `auth-broker.ts`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **Why does `createOnTrackAuthBroker()` connect `auth-broker.ts` to `cli.ts`, `auth-mcp-server.ts`, `OnTrackAuthBroker`, `auth-runtime.ts`, `printJson`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _211 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `utils.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07729468599033816 - nodes in this community are weakly interconnected._
- **Should `agent-protocol.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07764705882352942 - nodes in this community are weakly interconnected._
- **Should `Contract Drift Validation` be split into smaller, more focused modules?**
  _Cohesion score 0.0975609756097561 - nodes in this community are weakly interconnected._