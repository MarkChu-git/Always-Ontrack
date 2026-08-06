# Graph Report - .  (2026-08-06)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1260 nodes · 3431 edges · 60 communities (56 shown, 4 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 25 edges (avg confidence: 0.58)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `4493e512`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- agent-tasks.ts
- SessionData
- utils.ts
- cli.ts
- lightpanda-provider.ts
- agent-commands.ts
- auto-login.ts
- contracts.ts
- printJson
- command-spec.ts
- submission-lifecycle.ts
- handleInbox
- student-task-view.ts
- auth-broker.ts
- scripts
- discovery.ts
- planner.ts
- verify-package.ts
- agent-execution-engine.ts
- auth-runtime.ts
- artifact-safety.ts
- runWelcomeAction
- agent-plan.ts
- command-input.ts
- auth-mcp-server.ts
- execution-journal.ts
- captureSsoCredentialsInternal
- auto-login.test.ts
- check-coverage.ts
- types.ts
- package.json
- compilerOptions
- handleSubmissionUpload
- loadProjectsWithTaskMetadata
- launchBrowserForCapture
- session.ts
- captureCredentialsFromPersistedStateFile
- isBrowserStorageState
- whoami.ts
- check-skill-lock.ts
- createNativeAgentCommands
- extractCredentialsFromStorageEntries
- smoke-real.mjs
- devDependencies
- dependencies
- auto-login-session-reuse.test.ts
- keywords
- OnTrackAuthBroker
- check-gitnexus-skill-sync.ts
- AgentExecutionEngine
- TaskSummary
- check-skill-lock.test.ts
- bin
- overrides
- repository
- workflow-security.test.ts

## God Nodes (most connected - your core abstractions)
1. `SessionData` - 53 edges
2. `OnTrackApiClient` - 36 edges
3. `handleSubmissionUpload()` - 34 edges
4. `printJson()` - 34 edges
5. `main()` - 33 edges
6. `createAuthenticatedApi()` - 32 edges
7. `hasFlag()` - 32 edges
8. `requireSession()` - 30 edges
9. `loadProjectsWithTaskMetadata()` - 29 edges
10. `handleLogin()` - 28 edges

## Surprising Connections (you probably didn't know these)
- `submissionTask()` --calls--> `buildStudentTaskViews()`  [EXTRACTED]
  test/submission-lifecycle.test.ts → src/lib/student-task-view.ts
- `withClient()` --calls--> `createAuthMcpServer()`  [EXTRACTED]
  test/auth-mcp.test.ts → src/auth-mcp-server.ts
- `run()` --references--> `bun`  [EXTRACTED]
  scripts/verify-package.ts → package.json
- `withClient()` --references--> `client`  [EXTRACTED]
  test/auth-mcp.test.ts → scripts/check-gitnexus-mcp.ts
- `main()` --calls--> `launchLightpandaPublicSpike()`  [EXTRACTED]
  scripts/lightpanda-public-spike.ts → src/lib/lightpanda-provider.ts

## Import Cycles
- None detected.

## Communities (60 total, 4 thin omitted)

### Community 0 - "agent-tasks.ts"
Cohesion: 0.07
Nodes (74): AgentCallInputDependencies, AgentCallInvocation, invalidArgument(), parseAgentCallInvocation(), parseInputObject(), readProcessStdin(), AGENT_SAFE_TEXT_PATTERN, contractAliasedValue() (+66 more)

### Community 1 - "SessionData"
Cohesion: 0.08
Nodes (40): handleDoctor(), isForbiddenError(), listUnitsWithFallback(), authHeaders(), AuthSessionRefresh, buildErrorMessage(), DownloadResult, fetchOnTrack() (+32 more)

### Community 2 - "utils.ts"
Cohesion: 0.07
Nodes (53): FeedbackItem, buildPdfFilename(), buildTaskResourceFilename(), colorize(), COLORS_ENABLED, DEFAULT_DOWNLOAD_DIR, diffWatchStates(), ExternalOpenCommand (+45 more)

### Community 3 - "cli.ts"
Cohesion: 0.06
Nodes (54): agentSubmissionStatusInputFromSelector(), applyLimit(), arrayLength(), deriveUnitsFromProjects(), DIGITAL_LOGO_LINES, DoctorCheck, feedbackAuthor(), feedbackKind() (+46 more)

### Community 4 - "lightpanda-provider.ts"
Cohesion: 0.07
Nodes (35): main(), readPublicOktaUrl(), requiredLightpandaPath(), cleanupFailure(), defaultFileSystem, defaultRuntime, executableValidationError(), hasExited() (+27 more)

### Community 5 - "agent-commands.ts"
Cohesion: 0.04
Nodes (43): AgentAuthStatus, agentPlanPrerequisiteSchema, agentPlanProjectId, agentPlanSafeShortText, AgentPlanShowInput, AgentPlanShowOutput, agentPlanTaskSchema, agentProjectDirectoryItemSchema (+35 more)

### Community 6 - "auto-login.ts"
Cohesion: 0.06
Nodes (43): BrowserLaunchPlan, BrowserStorageEntry, BrowserStorageState, ClaimedBrowserSessionState, clickDetectedMfaOption(), collectCredentialScopes(), collectKnownMfaMethodOptions(), collectMfaSelectionOptions() (+35 more)

### Community 7 - "contracts.ts"
Cohesion: 0.10
Nodes (39): canonicalRoute(), collectShapeDrift(), collectUnexpectedKeys(), collectUnsafePayload(), collectUnsafeShapeEnums(), ContractDrift, ContractFixture, ContractFixtureMetadata (+31 more)

### Community 8 - "printJson"
Cohesion: 0.20
Nodes (40): createAuthenticatedApi(), handleAuthEnsure(), handleAuthMethod(), handleAuthStatus(), handleDiscover(), handleFeedbackCommand(), handleFeedbackList(), handleFeedbackWatch() (+32 more)

### Community 9 - "command-spec.ts"
Cohesion: 0.08
Nodes (28): AGENT_TASKS_LIST_MAX_STATUS_LENGTH, agentPlanShowInputSchema, agentPlanShowOutputSchema, agentProjectsListInputSchema, agentProjectsListOutputSchema, agentSubmissionStatusOutputSchema, agentTasksListInputSchema, agentTasksListOutputSchema (+20 more)

### Community 10 - "submission-lifecycle.ts"
Cohesion: 0.11
Nodes (29): booleanValue(), createSubmissionAttempt(), hasOwnField(), InvalidSubmissionDetailsError, isSubmissionObserved(), journalEntry(), parseStrictSubmissionDetails(), parseSubmissionDetails() (+21 more)

### Community 11 - "handleInbox"
Cohesion: 0.17
Nodes (29): buildInboxFallbackTasksFromProjectDetails(), buildWatchSnapshot(), countTasksByStatus(), dedupeInboxTasks(), describeWatchEvent(), extractInboxProjectId(), filterProjectsForWatch(), flattenTasks() (+21 more)

### Community 12 - "student-task-view.ts"
Cohesion: 0.17
Nodes (23): resolveSelectedStudentTask(), buildStudentTaskRows(), BuildStudentTaskViewOptions, buildStudentTaskViews(), definitionsForProject(), definitionTargetGrade(), definitionTutorialStream(), embeddedDefinition() (+15 more)

### Community 13 - "auth-broker.ts"
Cohesion: 0.15
Nodes (16): AuthStatusView, createOnTrackAuthBroker(), defaultDependencies(), OnTrackAuthBrokerDependencies, OnTrackAuthBrokerOptions, sessionFromCapture(), AutoLoginOptions, captureCredentialsFromStoredBrowserSession() (+8 more)

### Community 14 - "scripts"
Cohesion: 0.08
Nodes (26): scripts, build, clean, dev, gitnexus:analyze, gitnexus:check, gitnexus:context, gitnexus:detect-changes (+18 more)

### Community 15 - "discovery.ts"
Cohesion: 0.14
Nodes (21): ProbeResult, API_HINTS, classifyDiscoveredPaths(), discoverOnTrackSurface(), DiscoveryAsset, DiscoveryResult, extractDiscoveredPaths(), extractJavascriptAssetPaths() (+13 more)

### Community 16 - "planner.ts"
Cohesion: 0.14
Nodes (23): buildPlannerViews(), buildResetTargetDatesMutation(), buildTargetDateMutation(), dateFrom(), defaultDate(), gradeDateRow(), integerValue(), parseDateOnly() (+15 more)

### Community 17 - "verify-package.ts"
Cohesion: 0.12
Nodes (20): engines, bun, client, expectedTools, transport, assertChildPath(), assertRegularTree(), isAllowedEntry() (+12 more)

### Community 18 - "agent-execution-engine.ts"
Cohesion: 0.12
Nodes (22): AgentBasePolicy, AgentCallRequest, AgentCommandDefinition, AgentCommandManifest, AgentCommandPolicy, AgentExecutionEngineOptions, AgentExecutionEnvelope, AgentNonWritePolicy (+14 more)

### Community 19 - "auth-runtime.ts"
Cohesion: 0.14
Nodes (14): AuthInteractionMode, authRequired(), AuthRuntime, AuthRuntimeAdapter, createAuthRuntime(), credentialVersionChanged(), inFlightKey(), isFreshEnough() (+6 more)

### Community 20 - "artifact-safety.ts"
Cohesion: 0.22
Nodes (22): ArtifactOutputOptions, ArtifactPathOptions, ArtifactSafetyError, assertCleanPathInput(), assertNoSymbolicLinkComponents(), assertSafeFilename(), findExternalArtifactPaths(), inspectUploadFile() (+14 more)

### Community 21 - "runWelcomeAction"
Cohesion: 0.16
Nodes (23): buildTaskSelectorArgs(), expandHomePath(), handleWelcome(), help(), optionalFlagArgs(), parseTaskSelectorTokens(), promptExternalArtifactAuthorization(), promptGuidedOutputDirectory() (+15 more)

### Community 22 - "agent-plan.ts"
Cohesion: 0.31
Nodes (18): aliasValues(), buildAgentPlanShowOutput(), calendarDate(), nonNegativeInteger(), normalizePrerequisites(), own(), pairedArray(), pairedBoolean() (+10 more)

### Community 23 - "command-input.ts"
Cohesion: 0.14
Nodes (18): AGENT_GLOBAL_FLAGS, encodeField(), flagOccurrences(), GROUPED_AGENT_COMMANDS, mergeStructuredCommandInput(), parseObject(), readFlagValue(), removeFlagPair() (+10 more)

### Community 24 - "auth-mcp-server.ts"
Cohesion: 0.16
Nodes (14): AuthMcpDependencies, configuredBaseUrl(), createAuthMcpServer(), defaultDependencies(), nextActionSchema, serveAuthMcp(), toolResponse(), ToolResult (+6 more)

### Community 25 - "execution-journal.ts"
Cohesion: 0.23
Nodes (18): sanitizeAgentData(), atomicWrite(), claimExecution(), configRoot(), digest(), ExecutionClaim, executionFingerprint(), ExecutionJournalOptions (+10 more)

### Community 26 - "captureSsoCredentialsInternal"
Cohesion: 0.18
Nodes (20): advanceGuidedSsoOnPage(), BLOCKED_LINK_HOSTS, canUseSelector(), canUseSelectorInScopes(), captureSsoCredentialsInternal(), clickFirstVisible(), clickLikelyActionControl(), collectScopes() (+12 more)

### Community 27 - "auto-login.test.ts"
Cohesion: 0.18
Nodes (15): buildContextOptionsWithStoredSession(), classifySsoFallback(), clearAllBrowserSessionState(), clearBrowserSessionState(), expandSystemBrowserProfileCandidates(), extractCredentialsFromCookieJar(), extractCredentialsFromUrl(), isLikelyChromiumProfileDir() (+7 more)

### Community 28 - "check-coverage.ts"
Cohesion: 0.22
Nodes (15): assertThreshold(), checkCoverage(), CoverageEvaluation, CoverageMetric, CoverageSummary, CoverageThresholds, evaluateCoverage(), formatMetric() (+7 more)

### Community 29 - "types.ts"
Cohesion: 0.16
Nodes (13): AuthFailureKind, classifyAuthFailure(), createSessionFromAccessToken(), migrateLegacySession(), OnTrackHttpError, AccessTokenResponse, CredentialSource, OnTrackUser (+5 more)

### Community 30 - "package.json"
Cohesion: 0.12
Nodes (15): bugs, url, description, files, homepage, license, name, packageManager (+7 more)

### Community 31 - "compilerOptions"
Cohesion: 0.12
Nodes (15): node, src/**/*.ts, compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution, noEmitOnError (+7 more)

### Community 32 - "handleSubmissionUpload"
Cohesion: 0.23
Nodes (16): claimConfirmedWrite(), deriveDefaultSubmissionTrigger(), handlePlanCommand(), handlePlanReset(), handlePlanSetDates(), handleSubmissionUpload(), isDefinitiveWriteRejection(), loadPlannerContext() (+8 more)

### Community 33 - "loadProjectsWithTaskMetadata"
Cohesion: 0.15
Nodes (18): buildAgentSubmissionStatusOutput(), createNativeAgentExecutionEngine(), downloadTaskResourceArtifacts(), getUnitTaskDefinitions(), handleNativeAgentCommand(), loadProjectsWithTaskMetadata(), normalizeAgentCliError(), projectMatchesScope() (+10 more)

### Community 34 - "launchBrowserForCapture"
Cohesion: 0.12
Nodes (12): asErrorMessage(), browserInstallHint(), BrowserLaunchAdapter, candidateBrowserPaths(), captureSsoCredentialsWithGuidedLogin(), isMissingDisplayServerError(), isMissingSharedLibraryError(), launchBrowserForCapture() (+4 more)

### Community 35 - "session.ts"
Cohesion: 0.21
Nodes (14): AcquiredSessionRefreshLock, acquireSessionRefreshLock(), clearSession(), getConfigRoot(), getSessionPath(), isNodeError(), recoverStaleRefreshLock(), resolveSessionPath() (+6 more)

### Community 36 - "captureCredentialsFromPersistedStateFile"
Cohesion: 0.22
Nodes (9): captureCredentialsFromPersistedStateFile(), captureCredentialsFromSystemBrowserProfile(), closeBrowserAtMost(), extractCredentialsFromRequestHeaders(), isTargetOnTrackAuthUrl(), isTargetOnTrackUrl(), probeCredentialsInOpenContext(), SsoCaptureDeadline (+1 more)

### Community 37 - "isBrowserStorageState"
Cohesion: 0.29
Nodes (14): assertTrustedBrowserSessionStateDirectory(), claimBrowserSessionState(), filterBrowserSessionState(), hasReusableBrowserSessionState(), isBrowserStorageCookie(), isBrowserStorageOrigin(), isBrowserStorageState(), isRecord() (+6 more)

### Community 38 - "whoami.ts"
Cohesion: 0.29
Nodes (8): nonBlankStringValue(), numberValue(), stringValue(), toWhoAmIView(), WhoAmIView, makeSession(), runCliWhoAmI(), secretValues

### Community 39 - "check-skill-lock.ts"
Cohesion: 0.31
Nodes (9): collectFiles(), computeSkillFolderHash(), HashedFile, isRecord(), listInstalledSkillNames(), main(), parseLock(), SkillLock (+1 more)

### Community 41 - "extractCredentialsFromStorageEntries"
Cohesion: 0.36
Nodes (9): extractCredentialsFromAuthPayload(), extractCredentialsFromLocalStorage(), extractCredentialsFromStorageEntries(), extractCredentialsFromUnknownObject(), extractUsernameFromUserRecord(), hasValue(), normalizeStorageStringValue(), SystemBrowserProfileLocation (+1 more)

### Community 42 - "smoke-real.mjs"
Cohesion: 0.50
Nodes (7): main(), parseArgs(), pickFirstTask(), run(), runFeedbackWatch(), runJson(), runWatch()

### Community 43 - "devDependencies"
Cohesion: 0.29
Nodes (7): gitnexus, devDependencies, gitnexus, @types/node, typescript, @types/node, typescript

### Community 44 - "dependencies"
Cohesion: 0.29
Nodes (7): @modelcontextprotocol/sdk, dependencies, @modelcontextprotocol/sdk, playwright-core, zod, playwright-core, zod

### Community 45 - "auto-login-session-reuse.test.ts"
Cohesion: 0.33
Nodes (3): setBrowserSessionStatePathForTests(), browserStateEnvironmentTail, withBrowserState()

### Community 46 - "keywords"
Cohesion: 0.33
Nodes (6): keywords, agent, cli, doubtfire, mcp, ontrack

### Community 47 - "OnTrackAuthBroker"
Cohesion: 0.33
Nodes (3): OnTrackAuthBroker, AuthEnsureOptions, AuthRuntimeResult

### Community 49 - "check-gitnexus-skill-sync.ts"
Cohesion: 0.50
Nodes (3): packageRecord, packageValue, root

### Community 51 - "TaskSummary"
Cohesion: 0.50
Nodes (4): StudentTaskView, InboxTask, TaskDefinitionSummary, TaskSummary

### Community 53 - "bin"
Cohesion: 0.67
Nodes (3): bin, ontrack, ontrack-auth-mcp

### Community 54 - "overrides"
Cohesion: 0.67
Nodes (3): overrides, adm-zip, sharp

### Community 55 - "repository"
Cohesion: 0.67
Nodes (3): repository, type, url

## Knowledge Gaps
- **265 isolated node(s):** `name`, `version`, `description`, `license`, `type` (+260 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `withClient()` connect `verify-package.ts` to `auth-mcp-server.ts`?**
  _High betweenness centrality (0.112) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _265 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `agent-tasks.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06839945280437756 - nodes in this community are weakly interconnected._
- **Should `SessionData` be split into smaller, more focused modules?**
  _Cohesion score 0.08209876543209876 - nodes in this community are weakly interconnected._
- **Should `utils.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07078039927404718 - nodes in this community are weakly interconnected._
- **Should `cli.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06464646464646465 - nodes in this community are weakly interconnected._
- **Should `lightpanda-provider.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06988120195667366 - nodes in this community are weakly interconnected._