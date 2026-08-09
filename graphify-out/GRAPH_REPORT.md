# Graph Report - ontrack-cli  (2026-08-09)

## Corpus Check
- 79 files · ~94,754 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1022 nodes · 2645 edges · 61 communities (57 shown, 4 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 18 edges (avg confidence: 0.7)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `65f5d3f0`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- student-task-view.ts
- SessionData
- lightpanda-provider.ts
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
- planner.ts
- captureSsoCredentialsInternal
- extractCredentialsFromStorageEntries
- Domain Model Documentation
- auto-login-browser-adapter.test.ts
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
- submission-lifecycle.ts
- Contract Provenance Documentation
- Planner Semantics Documentation
- isBrowserStorageState
- types.ts
- Workflow Security Tests
- Lightpanda Auth Experiment
- auth.ts
- captureCredentialsFromPersistedStateFile
- handleSubmissionUpload
- printJson
- check-gitnexus-skill-sync.ts
- overrides
- Skill Lock Verification
- Skill Lock Tests
- CLI Binary Entrypoints
- requireSession
- runWelcomeAction
- handleFeedbackWatch
- check-gitnexus-mcp.ts
- repository
- OnTrackAuthBroker
- extractMfaNumberChallengeFromText

## God Nodes (most connected - your core abstractions)
1. `SessionData` - 47 edges
2. `printJson()` - 33 edges
3. `handleSubmissionUpload()` - 32 edges
4. `main()` - 32 edges
5. `hasFlag()` - 31 edges
6. `OnTrackApiClient` - 30 edges
7. `requireSession()` - 28 edges
8. `printTable()` - 27 edges
9. `scripts` - 26 edges
10. `handleLogin()` - 26 edges

## Surprising Connections (you probably didn't know these)
- `Agent-First Architecture` --semantically_similar_to--> `Agent Protocol`  [INFERRED] [semantically similar]
  docs/AGENT_READY_IMPLEMENTATION_PLAN.md → README.md
- `submissionTask()` --calls--> `buildStudentTaskViews()`  [EXTRACTED]
  test/submission-lifecycle.test.ts → src/lib/student-task-view.ts
- `Dependabot Dependency Updates` --implements--> `CI/CD Pipeline`  [INFERRED]
  .github/dependabot.yml → docs/CI_CD_DESIGN.md
- `CI Workflow` --implements--> `Coverage Ratchet`  [INFERRED]
  .github/workflows/ci.yml → docs/CI_CD_DESIGN.md
- `Dependency Review Workflow` --implements--> `CI/CD Pipeline`  [EXTRACTED]
  .github/workflows/dependency-review.yml → docs/CI_CD_DESIGN.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Five Deep Module Refactor** — docs_architecture_refactor_plan_auth_module, docs_architecture_refactor_plan_task_aggregation_module, docs_architecture_refactor_plan_submission_module, docs_architecture_refactor_plan_planner_module, docs_architecture_refactor_plan_contract_module [EXTRACTED 1.00]
- **Verified Release Artifact Chain** — github_workflows_ci_ci_pipeline, github_workflows_release_release_pipeline, docs_ci_cd_design_ci_cd_pipeline, docs_release_runbook_release_procedure [EXTRACTED 1.00]

## Communities (61 total, 4 thin omitted)

### Community 0 - "student-task-view.ts"
Cohesion: 0.16
Nodes (24): resolveSelectedStudentTask(), buildStudentTaskRows(), BuildStudentTaskViewOptions, buildStudentTaskViews(), definitionsForProject(), definitionTargetGrade(), definitionTutorialStream(), embeddedDefinition() (+16 more)

### Community 1 - "SessionData"
Cohesion: 0.12
Nodes (31): handleDoctor(), authHeaders(), AuthSessionRefresh, buildErrorMessage(), contentDispositionFilename(), DownloadResult, isReplaySafe(), JsonBody (+23 more)

### Community 2 - "lightpanda-provider.ts"
Cohesion: 0.07
Nodes (35): main(), readPublicOktaUrl(), requiredLightpandaPath(), cleanupFailure(), defaultFileSystem, defaultRuntime, executableValidationError(), hasExited() (+27 more)

### Community 3 - "utils.ts"
Cohesion: 0.08
Nodes (49): FeedbackItem, buildPdfFilename(), buildTaskResourceFilename(), colorize(), COLORS_ENABLED, DEFAULT_DOWNLOAD_DIR, diffWatchStates(), findTaskByAbbr() (+41 more)

### Community 4 - "agent-protocol.ts"
Cohesion: 0.09
Nodes (38): AGENT_SCHEMA_VERSION, AgentArtifact, AgentErrorCode, agentErrorEnvelope(), AgentFailureEnvelope, AgentNextAction, AgentOutputContext, AgentProtocolError (+30 more)

### Community 5 - "Contract Drift Validation"
Cohesion: 0.10
Nodes (39): canonicalRoute(), collectShapeDrift(), collectUnexpectedKeys(), collectUnsafePayload(), collectUnsafeShapeEnums(), ContractDrift, ContractFixture, ContractFixtureMetadata (+31 more)

### Community 6 - "command-spec.ts"
Cohesion: 0.08
Nodes (28): AGENT_GLOBAL_FLAGS, encodeField(), flagOccurrences(), GROUPED_AGENT_COMMANDS, mergeStructuredCommandInput(), parseObject(), readFlagValue(), removeFlagPair() (+20 more)

### Community 7 - "auto-login.ts"
Cohesion: 0.06
Nodes (48): asErrorMessage(), browserInstallHint(), BrowserLaunchPlan, BrowserStorageEntry, BrowserStorageState, candidateBrowserPaths(), ClaimedBrowserSessionState, clickDetectedMfaOption() (+40 more)

### Community 8 - "cli.ts"
Cohesion: 0.07
Nodes (42): applyLimit(), arrayLength(), dedupeInboxTasks(), deriveUnitsFromProjects(), describeWatchEvent(), DIGITAL_LOGO_LINES, DoctorCheck, extractInboxProjectId() (+34 more)

### Community 9 - "discovery.ts"
Cohesion: 0.14
Nodes (21): ProbeResult, API_HINTS, classifyDiscoveredPaths(), discoverOnTrackSurface(), DiscoveryAsset, DiscoveryResult, extractDiscoveredPaths(), extractJavascriptAssetPaths() (+13 more)

### Community 10 - "auto-login.test.ts"
Cohesion: 0.20
Nodes (14): buildContextOptionsWithStoredSession(), classifySsoFallback(), clearAllBrowserSessionState(), clearBrowserSessionState(), expandSystemBrowserProfileCandidates(), extractCredentialsFromCookieJar(), extractCredentialsFromUrl(), isLikelyChromiumProfileDir() (+6 more)

### Community 11 - "session.ts"
Cohesion: 0.15
Nodes (18): AcquiredSessionRefreshLock, acquireSessionRefreshLock(), AUTH_REFRESH_LOCK_TIMEOUT, clearSession(), getConfigRoot(), getSessionPath(), isNodeError(), recoverStaleRefreshLock() (+10 more)

### Community 12 - "Coverage Enforcement"
Cohesion: 0.22
Nodes (15): assertThreshold(), checkCoverage(), CoverageEvaluation, CoverageMetric, CoverageSummary, CoverageThresholds, evaluateCoverage(), formatMetric() (+7 more)

### Community 13 - "auth-mcp-server.ts"
Cohesion: 0.15
Nodes (16): client, AuthMcpDependencies, configuredBaseUrl(), createAuthMcpServer(), defaultDependencies(), nextActionSchema, serveAuthMcp(), toolResponse() (+8 more)

### Community 14 - "auth-broker.ts"
Cohesion: 0.19
Nodes (11): AuthStatusView, createOnTrackAuthBroker(), defaultDependencies(), OnTrackAuthBrokerDependencies, OnTrackAuthBrokerOptions, sessionFromCapture(), AutoLoginOptions, LoginCredentials (+3 more)

### Community 15 - "package.json"
Cohesion: 0.12
Nodes (15): bugs, url, description, files, homepage, license, name, packageManager (+7 more)

### Community 16 - "auth-runtime.ts"
Cohesion: 0.18
Nodes (11): AuthInteractionMode, authRequired(), AuthRuntime, AuthRuntimeAdapter, createAuthRuntime(), credentialVersionChanged(), inFlightKey(), isFreshEnough() (+3 more)

### Community 17 - "TypeScript Configuration"
Cohesion: 0.14
Nodes (13): src/**/*.ts, compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution, noEmitOnError, outDir (+5 more)

### Community 18 - "verify-package.ts"
Cohesion: 0.20
Nodes (16): engines, bun, assertChildPath(), assertRegularTree(), isAllowedEntry(), isSafeEntry(), main(), PackageVerification (+8 more)

### Community 19 - "planner.ts"
Cohesion: 0.14
Nodes (23): buildPlannerViews(), buildResetTargetDatesMutation(), buildTargetDateMutation(), dateFrom(), defaultDate(), gradeDateRow(), integerValue(), parseDateOnly() (+15 more)

### Community 20 - "captureSsoCredentialsInternal"
Cohesion: 0.18
Nodes (20): advanceGuidedSsoOnPage(), BLOCKED_LINK_HOSTS, canUseSelector(), canUseSelectorInScopes(), captureSsoCredentialsInternal(), clickFirstVisible(), clickLikelyActionControl(), collectScopes() (+12 more)

### Community 21 - "extractCredentialsFromStorageEntries"
Cohesion: 0.36
Nodes (9): extractCredentialsFromAuthPayload(), extractCredentialsFromLocalStorage(), extractCredentialsFromStorageEntries(), extractCredentialsFromUnknownObject(), extractUsernameFromUserRecord(), hasValue(), normalizeStorageStringValue(), SystemBrowserProfileLocation (+1 more)

### Community 22 - "Domain Model Documentation"
Cohesion: 0.22
Nodes (11): Evidence Slot, Student Task View, Submission Attempt, Task Definition, Task Instance, Task Reference, Unknown Outcome, Submission Lifecycle Module (+3 more)

### Community 23 - "auto-login-browser-adapter.test.ts"
Cohesion: 0.22
Nodes (5): BrowserLaunchAdapter, captureSsoCredentials(), captureSsoCredentialsWithGuidedLogin(), FakeBrowserOptions, Handler

### Community 24 - "Identity Output Redaction"
Cohesion: 0.29
Nodes (8): nonBlankStringValue(), numberValue(), stringValue(), toWhoAmIView(), WhoAmIView, makeSession(), runCliWhoAmI(), secretValues

### Community 25 - "auto-login-session-reuse.test.ts"
Cohesion: 0.33
Nodes (3): setBrowserSessionStatePathForTests(), browserStateEnvironmentTail, withBrowserState()

### Community 26 - "scripts"
Cohesion: 0.08
Nodes (26): scripts, build, clean, dev, gitnexus:analyze, gitnexus:check, gitnexus:context, gitnexus:detect-changes (+18 more)

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

### Community 35 - "submission-lifecycle.ts"
Cohesion: 0.14
Nodes (23): booleanValue(), createSubmissionAttempt(), isSubmissionObserved(), journalEntry(), parseSubmissionDetails(), PreparedSubmissionFile, prepareSubmission(), recordValue() (+15 more)

### Community 36 - "Contract Provenance Documentation"
Cohesion: 0.67
Nodes (4): Contract Drift, Contract Fixture, Observed Contract, Production Contract Discovery and Fixture Module

### Community 37 - "Planner Semantics Documentation"
Cohesion: 0.67
Nodes (3): Plan Date, Task Planner and Date Semantics Module, Task Planner

### Community 38 - "isBrowserStorageState"
Cohesion: 0.29
Nodes (14): assertTrustedBrowserSessionStateDirectory(), claimBrowserSessionState(), filterBrowserSessionState(), hasReusableBrowserSessionState(), isBrowserStorageCookie(), isBrowserStorageOrigin(), isBrowserStorageState(), isRecord() (+6 more)

### Community 39 - "types.ts"
Cohesion: 0.16
Nodes (13): StudentTaskRow, StudentTaskView, AuthMethodResponse, InboxTask, OnTrackUser, TaskBatchSelector, TaskDefinitionSummary, TaskSelector (+5 more)

### Community 45 - "auth.ts"
Cohesion: 0.24
Nodes (9): AuthFailureKind, classifyAuthFailure(), createSessionFromAccessToken(), migrateLegacySession(), OnTrackHttpError, sessionUsability, AccessTokenResponse, CredentialSource (+1 more)

### Community 46 - "captureCredentialsFromPersistedStateFile"
Cohesion: 0.23
Nodes (9): captureCredentialsFromPersistedStateFile(), captureCredentialsFromStoredBrowserSession(), captureCredentialsFromSystemBrowserProfile(), closeBrowserAtMost(), extractCredentialsFromRequestHeaders(), isSystemBrowserProfileReuseEnabled(), probeCredentialsInOpenContext(), SsoCaptureDeadline (+1 more)

### Community 47 - "handleSubmissionUpload"
Cohesion: 0.23
Nodes (16): claimConfirmedWrite(), deriveDefaultSubmissionTrigger(), handlePlanCommand(), handlePlanReset(), handlePlanSetDates(), handleSubmissionCommand(), handleSubmissionUpload(), isDefinitiveWriteRejection() (+8 more)

### Community 48 - "printJson"
Cohesion: 0.25
Nodes (24): handleAuthEnsure(), handleAuthMethod(), handleAuthStatus(), handleDiscover(), handleFileDownload(), handleLogin(), handleLogout(), handlePdfCommand() (+16 more)

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

### Community 54 - "requireSession"
Cohesion: 0.29
Nodes (23): buildInboxFallbackTasksFromProjectDetails(), countTasksByStatus(), createAuthenticatedApi(), flattenTasks(), handleInbox(), handleProjectShow(), handleSubmissionStatus(), handleTaskPrerequisites() (+15 more)

### Community 55 - "runWelcomeAction"
Cohesion: 0.17
Nodes (19): buildTaskSelectorArgs(), expandHomePath(), handleWelcome(), help(), optionalFlagArgs(), parseTaskSelectorTokens(), promptGuidedOutputDirectory(), promptGuidedTaskSelector() (+11 more)

### Community 56 - "handleFeedbackWatch"
Cohesion: 0.15
Nodes (20): buildWatchSnapshot(), feedbackAuthor(), feedbackKind(), feedbackMessage(), filterProjectsForWatch(), firstString(), formatDateTime(), handleFeedbackCommand() (+12 more)

### Community 58 - "repository"
Cohesion: 0.67
Nodes (3): repository, type, url

### Community 60 - "OnTrackAuthBroker"
Cohesion: 0.33
Nodes (3): OnTrackAuthBroker, AuthEnsureOptions, AuthRuntimeResult

### Community 61 - "extractMfaNumberChallengeFromText"
Cohesion: 0.50
Nodes (5): extractMfaNumberChallenge(), extractMfaNumberChallengeFromText(), extractNumberTokens(), hasMfaChallengeSignal(), uniqueInOrder()

## Knowledge Gaps
- **220 isolated node(s):** `name`, `version`, `description`, `license`, `type` (+215 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `client` connect `auth-mcp-server.ts` to `check-gitnexus-mcp.ts`, `verify-package.ts`?**
  _High betweenness centrality (0.134) - this node is a cross-community bridge._
- **Why does `verifyInstalledAuthMcp()` connect `verify-package.ts` to `auth-mcp-server.ts`?**
  _High betweenness centrality (0.123) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _220 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `SessionData` be split into smaller, more focused modules?**
  _Cohesion score 0.12316384180790961 - nodes in this community are weakly interconnected._
- **Should `lightpanda-provider.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06988120195667366 - nodes in this community are weakly interconnected._
- **Should `utils.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0803633822501747 - nodes in this community are weakly interconnected._
- **Should `agent-protocol.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09191583610188261 - nodes in this community are weakly interconnected._