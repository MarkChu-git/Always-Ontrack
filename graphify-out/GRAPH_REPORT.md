# Graph Report - ontrack-fix-slow-signin.1J4byP  (2026-07-31)

## Corpus Check
- 75 files · ~86,865 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 934 nodes · 2458 edges · 54 communities (50 shown, 4 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 13 edges (avg confidence: 0.78)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f7acad2f`
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
- captureSsoCredentialsInternal
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
- isBrowserStorageState
- Repository Metadata
- Workflow Security Tests
- Lightpanda Auth Experiment
- submission-lifecycle.ts
- probeCredentialsInOpenContext
- OnTrackAuthBroker
- TaskSummary
- check-gitnexus-skill-sync.ts
- overrides
- Skill Lock Verification
- Skill Lock Tests
- CLI Binary Entrypoints

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
- `CI Workflow` --implements--> `Coverage Ratchet`  [INFERRED]
  .github/workflows/ci.yml → docs/CI_CD_DESIGN.md
- `Dependency Review Workflow` --implements--> `CI/CD Pipeline`  [EXTRACTED]
  .github/workflows/dependency-review.yml → docs/CI_CD_DESIGN.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Five Deep Module Refactor** — docs_architecture_refactor_plan_auth_module, docs_architecture_refactor_plan_task_aggregation_module, docs_architecture_refactor_plan_submission_module, docs_architecture_refactor_plan_planner_module, docs_architecture_refactor_plan_contract_module [EXTRACTED 1.00]
- **Verified Release Artifact Chain** — github_workflows_ci_ci_pipeline, github_workflows_release_release_pipeline, docs_ci_cd_design_ci_cd_pipeline, docs_release_runbook_release_procedure [EXTRACTED 1.00]

## Communities (54 total, 4 thin omitted)

### Community 0 - "student-task-view.ts"
Cohesion: 0.16
Nodes (24): resolveSelectedStudentTask(), buildStudentTaskRows(), BuildStudentTaskViewOptions, buildStudentTaskViews(), definitionsForProject(), definitionTargetGrade(), definitionTutorialStream(), embeddedDefinition() (+16 more)

### Community 1 - "SessionData"
Cohesion: 0.15
Nodes (26): handleDoctor(), authHeaders(), AuthSessionRefresh, buildErrorMessage(), DownloadResult, isReplaySafe(), JsonBody, methodOf() (+18 more)

### Community 2 - "planner.ts"
Cohesion: 0.14
Nodes (23): buildPlannerViews(), buildResetTargetDatesMutation(), buildTargetDateMutation(), dateFrom(), defaultDate(), gradeDateRow(), integerValue(), parseDateOnly() (+15 more)

### Community 3 - "utils.ts"
Cohesion: 0.07
Nodes (51): StudentTaskRow, TaskSelector, colorize(), COLORS_ENABLED, DEFAULT_DOWNLOAD_DIR, diffWatchStates(), feedbackIdentity(), feedbackIdValue() (+43 more)

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
Cohesion: 0.07
Nodes (35): BrowserLaunchPlan, BrowserStorageEntry, BrowserStorageState, ClaimedBrowserSessionState, clickDetectedMfaOption(), collectKnownMfaMethodOptions(), collectMfaSelectionOptions(), collectSelectControls() (+27 more)

### Community 8 - "cli.ts"
Cohesion: 0.05
Nodes (144): applyLimit(), arrayLength(), buildInboxFallbackTasksFromProjectDetails(), buildTaskSelectorArgs(), buildWatchSnapshot(), claimConfirmedWrite(), countTasksByStatus(), createAuthenticatedApi() (+136 more)

### Community 9 - "discovery.ts"
Cohesion: 0.14
Nodes (21): ProbeResult, API_HINTS, classifyDiscoveredPaths(), discoverOnTrackSurface(), DiscoveryAsset, DiscoveryResult, extractDiscoveredPaths(), extractJavascriptAssetPaths() (+13 more)

### Community 10 - "auto-login.test.ts"
Cohesion: 0.18
Nodes (16): buildContextOptionsWithStoredSession(), candidateBrowserPaths(), captureCredentialsFromSystemBrowserProfile(), classifySsoFallback(), clearBrowserSessionState(), expandSystemBrowserProfileCandidates(), extractCredentialsFromCookieJar(), extractCredentialsFromUrl() (+8 more)

### Community 11 - "session.ts"
Cohesion: 0.20
Nodes (15): AcquiredSessionRefreshLock, acquireSessionRefreshLock(), clearSession(), getConfigRoot(), getSessionPath(), isNodeError(), recoverStaleRefreshLock(), resolveSessionPath() (+7 more)

### Community 12 - "Coverage Enforcement"
Cohesion: 0.22
Nodes (15): assertThreshold(), checkCoverage(), CoverageEvaluation, CoverageMetric, CoverageSummary, CoverageThresholds, evaluateCoverage(), formatMetric() (+7 more)

### Community 13 - "auth-mcp-server.ts"
Cohesion: 0.14
Nodes (14): client, expectedTools, transport, AuthMcpDependencies, configuredBaseUrl(), createAuthMcpServer(), defaultDependencies(), nextActionSchema (+6 more)

### Community 14 - "auth-broker.ts"
Cohesion: 0.17
Nodes (14): AuthStatusView, createOnTrackAuthBroker(), defaultDependencies(), OnTrackAuthBrokerDependencies, OnTrackAuthBrokerOptions, sessionFromCapture(), AutoLoginOptions, captureCredentialsFromStoredBrowserSession() (+6 more)

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
Cohesion: 0.14
Nodes (14): AuthFailureKind, classifyAuthFailure(), createSessionFromAccessToken(), migrateLegacySession(), OnTrackHttpError, AccessTokenResponse, CredentialSource, OnTrackUser (+6 more)

### Community 20 - "captureSsoCredentialsInternal"
Cohesion: 0.18
Nodes (20): advanceGuidedSsoOnPage(), BLOCKED_LINK_HOSTS, canUseSelector(), canUseSelectorInScopes(), captureSsoCredentialsInternal(), clickFirstVisible(), clickLikelyActionControl(), collectScopes() (+12 more)

### Community 21 - "extractCredentialsFromStorageEntries"
Cohesion: 0.43
Nodes (8): extractCredentialsFromAuthPayload(), extractCredentialsFromStorageEntries(), extractCredentialsFromUnknownObject(), extractUsernameFromUserRecord(), hasValue(), normalizeStorageStringValue(), SystemBrowserProfileLocation, tryParseJson()

### Community 22 - "Domain Model Documentation"
Cohesion: 0.22
Nodes (11): Evidence Slot, Student Task View, Submission Attempt, Task Definition, Task Instance, Task Reference, Unknown Outcome, Submission Lifecycle Module (+3 more)

### Community 23 - "launchBrowserForCapture"
Cohesion: 0.17
Nodes (9): asErrorMessage(), browserInstallHint(), BrowserLaunchAdapter, captureSsoCredentialsWithGuidedLogin(), isMissingDisplayServerError(), isMissingSharedLibraryError(), launchBrowserForCapture(), FakeBrowserOptions (+1 more)

### Community 24 - "Identity Output Redaction"
Cohesion: 0.29
Nodes (8): nonBlankStringValue(), numberValue(), stringValue(), toWhoAmIView(), WhoAmIView, makeSession(), runCliWhoAmI(), secretValues

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

### Community 38 - "isBrowserStorageState"
Cohesion: 0.28
Nodes (15): assertTrustedBrowserSessionStateDirectory(), captureCredentialsFromPersistedStateFile(), claimBrowserSessionState(), filterBrowserSessionState(), hasReusableBrowserSessionState(), isBrowserStorageCookie(), isBrowserStorageOrigin(), isBrowserStorageState() (+7 more)

### Community 39 - "Repository Metadata"
Cohesion: 0.67
Nodes (3): repository, type, url

### Community 45 - "submission-lifecycle.ts"
Cohesion: 0.14
Nodes (23): booleanValue(), createSubmissionAttempt(), isSubmissionObserved(), journalEntry(), parseSubmissionDetails(), PreparedSubmissionFile, prepareSubmission(), recordValue() (+15 more)

### Community 46 - "probeCredentialsInOpenContext"
Cohesion: 0.40
Nodes (5): extractCredentialsFromLocalStorage(), extractCredentialsFromRequestHeaders(), isTargetOnTrackAuthUrl(), isTargetOnTrackUrl(), probeCredentialsInOpenContext()

### Community 47 - "OnTrackAuthBroker"
Cohesion: 0.33
Nodes (3): OnTrackAuthBroker, AuthEnsureOptions, AuthRuntimeResult

### Community 48 - "TaskSummary"
Cohesion: 0.50
Nodes (4): StudentTaskView, InboxTask, TaskDefinitionSummary, TaskSummary

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

## Knowledge Gaps
- **211 isolated node(s):** `name`, `version`, `description`, `license`, `type` (+206 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `SessionData` connect `SessionData` to `cli.ts`, `discovery.ts`, `session.ts`, `auth-broker.ts`, `OnTrackAuthBroker`, `auth-runtime.ts`, `types.ts`, `Identity Output Redaction`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Why does `OnTrackApiClient` connect `SessionData` to `cli.ts`, `auto-login.test.ts`, `types.ts`, `auth-broker.ts`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **Why does `createOnTrackAuthBroker()` connect `auth-broker.ts` to `cli.ts`, `auth-runtime.ts`, `auth-mcp-server.ts`, `OnTrackAuthBroker`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _211 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `planner.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.13846153846153847 - nodes in this community are weakly interconnected._
- **Should `utils.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07272727272727272 - nodes in this community are weakly interconnected._
- **Should `agent-protocol.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09191583610188261 - nodes in this community are weakly interconnected._