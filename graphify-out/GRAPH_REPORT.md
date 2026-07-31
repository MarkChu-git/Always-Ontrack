# Graph Report - ontrack-fix-slow-signin.1J4byP  (2026-07-31)

## Corpus Check
- 75 files · ~85,464 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 928 nodes · 2437 edges · 49 communities (46 shown, 3 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 13 edges (avg confidence: 0.78)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d5b54c22`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- student-task-view.ts
- SessionData
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
- captureCredentialsFromStoredBrowserSession
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

## Communities (49 total, 3 thin omitted)

### Community 0 - "student-task-view.ts"
Cohesion: 0.05
Nodes (73): resolveSelectedStudentTask(), buildPlannerViews(), buildTargetDateMutation(), dateFrom(), defaultDate(), gradeDateRow(), integerValue(), parseDateOnly() (+65 more)

### Community 1 - "SessionData"
Cohesion: 0.16
Nodes (24): handleDoctor(), authHeaders(), AuthSessionRefresh, buildErrorMessage(), DownloadResult, isReplaySafe(), JsonBody, methodOf() (+16 more)

### Community 3 - "utils.ts"
Cohesion: 0.07
Nodes (67): buildWatchSnapshot(), filterProjectsForWatch(), promptGuidedTaskSelector(), promptTaskSelectorFromTaskList(), StudentTaskRow, FeedbackItem, TaskSelector, buildPdfFilename() (+59 more)

### Community 4 - "agent-protocol.ts"
Cohesion: 0.10
Nodes (36): AGENT_SCHEMA_VERSION, AgentArtifact, AgentErrorCode, agentErrorEnvelope(), AgentFailureEnvelope, AgentNextAction, AgentOutputContext, AgentProtocolErrorOptions (+28 more)

### Community 5 - "Contract Drift Validation"
Cohesion: 0.10
Nodes (39): canonicalRoute(), collectShapeDrift(), collectUnexpectedKeys(), collectUnsafePayload(), collectUnsafeShapeEnums(), ContractDrift, ContractFixture, ContractFixtureMetadata (+31 more)

### Community 6 - "command-spec.ts"
Cohesion: 0.08
Nodes (29): AgentProtocolError, AGENT_GLOBAL_FLAGS, encodeField(), flagOccurrences(), GROUPED_AGENT_COMMANDS, mergeStructuredCommandInput(), parseObject(), readFlagValue() (+21 more)

### Community 7 - "auto-login.ts"
Cohesion: 0.07
Nodes (36): BrowserLaunchPlan, BrowserStorageEntry, BrowserStorageState, ClaimedBrowserSessionState, clickDetectedMfaOption(), collectKnownMfaMethodOptions(), collectMfaSelectionOptions(), collectSelectControls() (+28 more)

### Community 8 - "cli.ts"
Cohesion: 0.06
Nodes (131): applyLimit(), arrayLength(), buildInboxFallbackTasksFromProjectDetails(), buildTaskSelectorArgs(), claimConfirmedWrite(), countTasksByStatus(), createAuthenticatedApi(), dedupeInboxTasks() (+123 more)

### Community 9 - "discovery.ts"
Cohesion: 0.13
Nodes (21): ProbeResult, API_HINTS, classifyDiscoveredPaths(), discoverOnTrackSurface(), DiscoveryAsset, DiscoveryResult, extractDiscoveredPaths(), extractJavascriptAssetPaths() (+13 more)

### Community 10 - "auto-login.test.ts"
Cohesion: 0.23
Nodes (12): candidateBrowserPaths(), captureCredentialsFromSystemBrowserProfile(), classifySsoFallback(), expandSystemBrowserProfileCandidates(), extractCredentialsFromCookieJar(), extractCredentialsFromRequestHeaders(), extractCredentialsFromUrl(), isLikelyChromiumProfileDir() (+4 more)

### Community 11 - "session.ts"
Cohesion: 0.15
Nodes (18): AcquiredSessionRefreshLock, acquireSessionRefreshLock(), AUTH_REFRESH_LOCK_TIMEOUT, clearSession(), getConfigRoot(), getSessionPath(), isNodeError(), recoverStaleRefreshLock() (+10 more)

### Community 12 - "Coverage Enforcement"
Cohesion: 0.22
Nodes (15): assertThreshold(), checkCoverage(), CoverageEvaluation, CoverageMetric, CoverageSummary, CoverageThresholds, evaluateCoverage(), formatMetric() (+7 more)

### Community 13 - "auth-mcp-server.ts"
Cohesion: 0.12
Nodes (15): client, expectedTools, transport, AuthMcpDependencies, configuredBaseUrl(), createAuthMcpServer(), defaultDependencies(), nextActionSchema (+7 more)

### Community 14 - "auth-broker.ts"
Cohesion: 0.16
Nodes (13): AuthStatusView, createOnTrackAuthBroker(), defaultDependencies(), OnTrackAuthBrokerDependencies, OnTrackAuthBrokerOptions, sessionFromCapture(), AuthEnsureOptions, AuthRuntimeResult (+5 more)

### Community 15 - "package.json"
Cohesion: 0.12
Nodes (15): bugs, url, description, files, homepage, license, name, packageManager (+7 more)

### Community 16 - "auth-runtime.ts"
Cohesion: 0.17
Nodes (12): AuthInteractionMode, authRequired(), AuthRuntime, AuthRuntimeAdapter, createAuthRuntime(), credentialVersionChanged(), inFlightKey(), isFreshEnough() (+4 more)

### Community 17 - "TypeScript Configuration"
Cohesion: 0.14
Nodes (13): src/**/*.ts, compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution, noEmitOnError, outDir (+5 more)

### Community 18 - "verify-package.ts"
Cohesion: 0.22
Nodes (14): engines, bun, assertChildPath(), assertRegularTree(), isAllowedEntry(), isSafeEntry(), main(), PackageVerification (+6 more)

### Community 19 - "types.ts"
Cohesion: 0.14
Nodes (15): AuthFailureKind, classifyAuthFailure(), createSessionFromAccessToken(), migrateLegacySession(), OnTrackHttpError, AccessTokenResponse, CredentialSource, InboxTask (+7 more)

### Community 20 - "captureSsoCredentialsInternal"
Cohesion: 0.17
Nodes (21): advanceGuidedSsoOnPage(), BLOCKED_LINK_HOSTS, canUseSelector(), canUseSelectorInScopes(), captureSsoCredentialsInternal(), clickFirstVisible(), clickLikelyActionControl(), collectScopes() (+13 more)

### Community 21 - "extractCredentialsFromStorageEntries"
Cohesion: 0.29
Nodes (12): extractCredentialsFromAuthPayload(), extractCredentialsFromStorageEntries(), extractCredentialsFromUnknownObject(), extractUsernameFromUserRecord(), hasValue(), isBrowserStorageCookie(), isBrowserStorageOrigin(), isBrowserStorageState() (+4 more)

### Community 22 - "Domain Model Documentation"
Cohesion: 0.22
Nodes (11): Evidence Slot, Student Task View, Submission Attempt, Task Definition, Task Instance, Task Reference, Unknown Outcome, Submission Lifecycle Module (+3 more)

### Community 23 - "launchBrowserForCapture"
Cohesion: 0.15
Nodes (10): asErrorMessage(), browserInstallHint(), BrowserLaunchAdapter, captureSsoCredentials(), captureSsoCredentialsWithGuidedLogin(), isMissingDisplayServerError(), isMissingSharedLibraryError(), launchBrowserForCapture() (+2 more)

### Community 24 - "Identity Output Redaction"
Cohesion: 0.29
Nodes (8): nonBlankStringValue(), numberValue(), stringValue(), toWhoAmIView(), WhoAmIView, makeSession(), runCliWhoAmI(), secretValues

### Community 25 - "captureCredentialsFromStoredBrowserSession"
Cohesion: 0.29
Nodes (3): captureCredentialsFromStoredBrowserSession(), isSystemBrowserProfileReuseEnabled(), browserStateEnvironmentTail

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
Cohesion: 0.35
Nodes (11): buildContextOptionsWithStoredSession(), captureCredentialsFromPersistedStateFile(), claimBrowserSessionState(), clearBrowserSessionState(), filterBrowserSessionState(), hasReusableBrowserSessionState(), publishCapturedBrowserSessionState(), resolveBrowserSessionStatePath() (+3 more)

### Community 39 - "Repository Metadata"
Cohesion: 0.67
Nodes (3): repository, type, url

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
- **210 isolated node(s):** `name`, `version`, `description`, `license`, `type` (+205 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `SessionData` connect `SessionData` to `cli.ts`, `discovery.ts`, `session.ts`, `auth-mcp-server.ts`, `auth-broker.ts`, `auth-runtime.ts`, `types.ts`, `Identity Output Redaction`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Why does `OnTrackApiClient` connect `SessionData` to `cli.ts`, `types.ts`, `auth-broker.ts`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **Why does `createOnTrackAuthBroker()` connect `auth-broker.ts` to `cli.ts`, `auth-runtime.ts`, `auth-mcp-server.ts`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _210 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `student-task-view.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05058717253839205 - nodes in this community are weakly interconnected._
- **Should `utils.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06651017214397496 - nodes in this community are weakly interconnected._
- **Should `agent-protocol.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09743589743589744 - nodes in this community are weakly interconnected._