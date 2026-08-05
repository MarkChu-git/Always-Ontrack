# Graph Report - artifact-safety  (2026-08-05)

## Corpus Check
- 86 files · ~101,444 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1120 nodes · 2874 edges · 61 communities (58 shown, 3 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 16 edges (avg confidence: 0.73)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d06987ec`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- handleFeedbackWatch
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
- compilerOptions
- verify-package.ts
- OnTrackAuthBroker
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
- student-task-view.ts
- Contract Provenance Documentation
- Planner Semantics Documentation
- isBrowserStorageState
- agent-execution-engine.ts
- Workflow Security Tests
- Lightpanda Auth Experiment
- artifact-safety.ts
- captureCredentialsFromPersistedStateFile
- execution-journal.ts
- main
- check-gitnexus-skill-sync.ts
- overrides
- Skill Lock Verification
- Skill Lock Tests
- CLI Binary Entrypoints
- types.ts
- agent-commands.ts
- repository
- agent-call-input.ts
- runWelcomeAction
- handleSubmissionUpload
- createNativeAgentExecutionEngine

## God Nodes (most connected - your core abstractions)
1. `SessionData` - 46 edges
2. `handleSubmissionUpload()` - 34 edges
3. `main()` - 33 edges
4. `printJson()` - 33 edges
5. `hasFlag()` - 31 edges
6. `requireSession()` - 29 edges
7. `OnTrackApiClient` - 29 edges
8. `printTable()` - 27 edges
9. `scripts` - 26 edges
10. `handleLogin()` - 26 edges

## Surprising Connections (you probably didn't know these)
- `Agent-First Architecture` --semantically_similar_to--> `Agent Protocol`  [INFERRED] [semantically similar]
  docs/AGENT_READY_IMPLEMENTATION_PLAN.md → README.md
- `Dependabot Dependency Updates` --implements--> `CI/CD Pipeline`  [INFERRED]
  .github/dependabot.yml → docs/CI_CD_DESIGN.md
- `submissionTask()` --calls--> `buildStudentTaskViews()`  [EXTRACTED]
  test/submission-lifecycle.test.ts → src/lib/student-task-view.ts
- `CI Workflow` --implements--> `Coverage Ratchet`  [INFERRED]
  .github/workflows/ci.yml → docs/CI_CD_DESIGN.md
- `Dependency Review Workflow` --implements--> `CI/CD Pipeline`  [EXTRACTED]
  .github/workflows/dependency-review.yml → docs/CI_CD_DESIGN.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Five Deep Module Refactor** — docs_architecture_refactor_plan_auth_module, docs_architecture_refactor_plan_task_aggregation_module, docs_architecture_refactor_plan_submission_module, docs_architecture_refactor_plan_planner_module, docs_architecture_refactor_plan_contract_module [EXTRACTED 1.00]
- **Verified Release Artifact Chain** — github_workflows_ci_ci_pipeline, github_workflows_release_release_pipeline, docs_ci_cd_design_ci_cd_pipeline, docs_release_runbook_release_procedure [EXTRACTED 1.00]

## Communities (61 total, 3 thin omitted)

### Community 0 - "handleFeedbackWatch"
Cohesion: 0.23
Nodes (13): feedbackAuthor(), feedbackKind(), feedbackMessage(), firstString(), formatDateTime(), handleFeedbackCommand(), handleFeedbackWatch(), presentFeedbackRows() (+5 more)

### Community 1 - "SessionData"
Cohesion: 0.12
Nodes (31): handleDoctor(), authHeaders(), AuthSessionRefresh, buildErrorMessage(), DownloadResult, fetchOnTrack(), isReplaySafe(), JsonBody (+23 more)

### Community 2 - "lightpanda-provider.ts"
Cohesion: 0.07
Nodes (35): main(), readPublicOktaUrl(), requiredLightpandaPath(), cleanupFailure(), defaultFileSystem, defaultRuntime, executableValidationError(), hasExited() (+27 more)

### Community 3 - "utils.ts"
Cohesion: 0.07
Nodes (57): buildStudentTaskRows(), StudentTaskRow, TaskSelector, buildPdfFilename(), colorize(), COLORS_ENABLED, DEFAULT_DOWNLOAD_DIR, diffWatchStates() (+49 more)

### Community 4 - "agent-protocol.ts"
Cohesion: 0.16
Nodes (22): AGENT_SCHEMA_VERSION, AgentArtifact, AgentErrorCode, agentErrorEnvelope(), AgentNextAction, AgentOutputContext, AgentProtocolErrorOptions, AgentStatus (+14 more)

### Community 5 - "Contract Drift Validation"
Cohesion: 0.10
Nodes (39): canonicalRoute(), collectShapeDrift(), collectUnexpectedKeys(), collectUnsafePayload(), collectUnsafeShapeEnums(), ContractDrift, ContractFixture, ContractFixtureMetadata (+31 more)

### Community 6 - "command-spec.ts"
Cohesion: 0.08
Nodes (29): AGENT_GLOBAL_FLAGS, encodeField(), flagOccurrences(), GROUPED_AGENT_COMMANDS, mergeStructuredCommandInput(), parseObject(), readFlagValue(), removeFlagPair() (+21 more)

### Community 7 - "auto-login.ts"
Cohesion: 0.06
Nodes (51): asErrorMessage(), browserInstallHint(), BrowserLaunchPlan, BrowserStorageEntry, BrowserStorageState, candidateBrowserPaths(), ClaimedBrowserSessionState, clickDetectedMfaOption() (+43 more)

### Community 8 - "cli.ts"
Cohesion: 0.08
Nodes (41): applyLimit(), arrayLength(), buildWatchSnapshot(), countTasksByStatus(), dedupeInboxTasks(), deriveDefaultSubmissionTrigger(), deriveUnitsFromProjects(), DIGITAL_LOGO_LINES (+33 more)

### Community 9 - "discovery.ts"
Cohesion: 0.14
Nodes (21): ProbeResult, API_HINTS, classifyDiscoveredPaths(), discoverOnTrackSurface(), DiscoveryAsset, DiscoveryResult, extractDiscoveredPaths(), extractJavascriptAssetPaths() (+13 more)

### Community 10 - "auto-login.test.ts"
Cohesion: 0.18
Nodes (15): buildContextOptionsWithStoredSession(), classifySsoFallback(), clearAllBrowserSessionState(), clearBrowserSessionState(), expandSystemBrowserProfileCandidates(), extractCredentialsFromCookieJar(), extractCredentialsFromUrl(), isLikelyChromiumProfileDir() (+7 more)

### Community 11 - "session.ts"
Cohesion: 0.19
Nodes (16): migrateLegacySession(), AcquiredSessionRefreshLock, acquireSessionRefreshLock(), clearSession(), getConfigRoot(), getSessionPath(), isNodeError(), loadSession() (+8 more)

### Community 12 - "Coverage Enforcement"
Cohesion: 0.22
Nodes (15): assertThreshold(), checkCoverage(), CoverageEvaluation, CoverageMetric, CoverageSummary, CoverageThresholds, evaluateCoverage(), formatMetric() (+7 more)

### Community 13 - "auth-mcp-server.ts"
Cohesion: 0.11
Nodes (18): client, expectedTools, transport, AuthMcpDependencies, configuredBaseUrl(), createAuthMcpServer(), defaultDependencies(), nextActionSchema (+10 more)

### Community 14 - "auth-broker.ts"
Cohesion: 0.15
Nodes (18): handleLogin(), readAuthStatus(), AuthStatusView, createOnTrackAuthBroker(), defaultDependencies(), OnTrackAuthBrokerDependencies, OnTrackAuthBrokerOptions, sessionFromCapture() (+10 more)

### Community 15 - "package.json"
Cohesion: 0.12
Nodes (15): bugs, url, description, files, homepage, license, name, packageManager (+7 more)

### Community 16 - "auth-runtime.ts"
Cohesion: 0.14
Nodes (14): AuthInteractionMode, authRequired(), AuthRuntime, AuthRuntimeAdapter, createAuthRuntime(), credentialVersionChanged(), inFlightKey(), isFreshEnough() (+6 more)

### Community 17 - "compilerOptions"
Cohesion: 0.12
Nodes (15): node, src/**/*.ts, compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution, noEmitOnError (+7 more)

### Community 18 - "verify-package.ts"
Cohesion: 0.20
Nodes (16): engines, bun, assertChildPath(), assertRegularTree(), isAllowedEntry(), isSafeEntry(), main(), PackageVerification (+8 more)

### Community 19 - "OnTrackAuthBroker"
Cohesion: 0.33
Nodes (3): OnTrackAuthBroker, AuthEnsureOptions, AuthRuntimeResult

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
Cohesion: 0.25
Nodes (4): BrowserLaunchAdapter, captureSsoCredentialsWithGuidedLogin(), FakeBrowserOptions, Handler

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

### Community 35 - "student-task-view.ts"
Cohesion: 0.05
Nodes (71): buildPlannerViews(), buildTargetDateMutation(), dateFrom(), defaultDate(), gradeDateRow(), integerValue(), parseDateOnly(), personalDate() (+63 more)

### Community 36 - "Contract Provenance Documentation"
Cohesion: 0.67
Nodes (4): Contract Drift, Contract Fixture, Observed Contract, Production Contract Discovery and Fixture Module

### Community 37 - "Planner Semantics Documentation"
Cohesion: 0.67
Nodes (3): Plan Date, Task Planner and Date Semantics Module, Task Planner

### Community 38 - "isBrowserStorageState"
Cohesion: 0.29
Nodes (14): assertTrustedBrowserSessionStateDirectory(), claimBrowserSessionState(), filterBrowserSessionState(), hasReusableBrowserSessionState(), isBrowserStorageCookie(), isBrowserStorageOrigin(), isBrowserStorageState(), isRecord() (+6 more)

### Community 39 - "agent-execution-engine.ts"
Cohesion: 0.12
Nodes (20): AgentBasePolicy, AgentCallRequest, AgentCommandManifest, AgentCommandPolicy, AgentExecutionEngine, AgentExecutionEngineOptions, AgentExecutionEnvelope, AgentNonWritePolicy (+12 more)

### Community 45 - "artifact-safety.ts"
Cohesion: 0.22
Nodes (22): ArtifactOutputOptions, ArtifactPathOptions, ArtifactSafetyError, assertCleanPathInput(), assertNoSymbolicLinkComponents(), assertSafeFilename(), findExternalArtifactPaths(), inspectUploadFile() (+14 more)

### Community 46 - "captureCredentialsFromPersistedStateFile"
Cohesion: 0.22
Nodes (9): captureCredentialsFromPersistedStateFile(), captureCredentialsFromSystemBrowserProfile(), closeBrowserAtMost(), extractCredentialsFromRequestHeaders(), isTargetOnTrackAuthUrl(), isTargetOnTrackUrl(), probeCredentialsInOpenContext(), SsoCaptureDeadline (+1 more)

### Community 47 - "execution-journal.ts"
Cohesion: 0.25
Nodes (17): atomicWrite(), claimExecution(), configRoot(), digest(), ExecutionClaim, executionFingerprint(), ExecutionJournalOptions, ExecutionRecord (+9 more)

### Community 48 - "main"
Cohesion: 0.17
Nodes (48): buildInboxFallbackTasksFromProjectDetails(), createAuthenticatedApi(), describeWatchEvent(), flattenTasks(), getUnitTaskDefinitions(), handleAuthEnsure(), handleAuthMethod(), handleAuthStatus() (+40 more)

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

### Community 55 - "types.ts"
Cohesion: 0.15
Nodes (13): sessionFromAccessTokenCapture(), AuthFailureKind, classifyAuthFailure(), createSessionFromAccessToken(), OnTrackHttpError, AccessTokenResponse, CredentialSource, OnTrackUser (+5 more)

### Community 56 - "agent-commands.ts"
Cohesion: 0.10
Nodes (17): AgentAuthStatus, AgentTaskShowInput, agentTaskShowInputSchema, agentTaskShowItemSchema, AgentTaskShowOutput, agentTaskShowOutputSchema, authStatusInputSchema, authStatusOutputSchema (+9 more)

### Community 58 - "repository"
Cohesion: 0.67
Nodes (3): repository, type, url

### Community 59 - "agent-call-input.ts"
Cohesion: 0.43
Nodes (6): AgentCallInputDependencies, AgentCallInvocation, invalidArgument(), parseAgentCallInvocation(), parseInputObject(), readProcessStdin()

### Community 60 - "runWelcomeAction"
Cohesion: 0.14
Nodes (27): buildTaskSelectorArgs(), expandHomePath(), handleWelcome(), help(), optionalFlagArgs(), panelBodyCode(), panelToneCode(), panelVisibleLength() (+19 more)

### Community 61 - "handleSubmissionUpload"
Cohesion: 0.19
Nodes (19): claimConfirmedWrite(), handlePlanCommand(), handlePlanReset(), handlePlanSetDates(), handleSubmissionCommand(), handleSubmissionUpload(), isDefinitiveWriteRejection(), loadPlannerContext() (+11 more)

### Community 65 - "createNativeAgentExecutionEngine"
Cohesion: 0.50
Nodes (5): createNativeAgentExecutionEngine(), handleNativeAgentCommand(), normalizeAgentCliError(), exitCodeForAgentEnvelope(), exitCodeForAgentErrorCode()

## Knowledge Gaps
- **243 isolated node(s):** `name`, `version`, `description`, `license`, `type` (+238 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `client` connect `auth-mcp-server.ts` to `verify-package.ts`?**
  _High betweenness centrality (0.114) - this node is a cross-community bridge._
- **Why does `verifyInstalledAuthMcp()` connect `verify-package.ts` to `auth-mcp-server.ts`?**
  _High betweenness centrality (0.103) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _243 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `SessionData` be split into smaller, more focused modules?**
  _Cohesion score 0.11748633879781421 - nodes in this community are weakly interconnected._
- **Should `lightpanda-provider.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06988120195667366 - nodes in this community are weakly interconnected._
- **Should `utils.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06874669487043893 - nodes in this community are weakly interconnected._
- **Should `Contract Drift Validation` be split into smaller, more focused modules?**
  _Cohesion score 0.0975609756097561 - nodes in this community are weakly interconnected._