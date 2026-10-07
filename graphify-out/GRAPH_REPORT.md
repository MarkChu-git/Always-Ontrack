# Graph Report - wt-77  (2026-10-08)

## Corpus Check
- 151 files · ~208,633 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2161 nodes · 5544 edges · 107 communities (101 shown, 6 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 51 edges (avg confidence: 0.58)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `4e6400c6`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- agent-project-unit-canonical.ts
- api.ts
- utils.ts
- agent-units.ts
- lightpanda-provider.ts
- agent-commands.ts
- auto-login.ts
- contracts.ts
- createAuthenticatedApi
- command-spec.ts
- agent-task-reads.ts
- AgentProtocolError
- remoteContractFailure
- auth-broker.ts
- scripts
- discovery.ts
- agent-watch.ts
- auth-mcp-server.ts
- OnTrack 真实环境变化审计（2026-07-31）
- auth-runtime.ts
- submission-lifecycle.ts
- OnTrack CLI CI/CD 设计
- handleLogin
- command-input.ts
- project-catalogue.ts
- agent-protocol.ts
- captureSsoCredentialsInternal
- auto-login.test.ts
- check-coverage.ts
- agent-feedback.ts
- package.json
- compilerOptions
- OnTrack CLI Agent-Ready 实施计划
- data.ts
- utils-coverage.test.ts
- session.ts
- .run
- persistRefreshCookie
- app.tsx
- check-skill-lock.ts
- smoke-tui.tsx
- loadProjectsWithTaskMetadata
- smoke-real.mjs
- devDependencies
- dependencies
- agent-plan.ts
- keywords
- watch-snapshots.ts
- check-gitnexus-skill-sync.ts
- createNativeAgentCommands
- OnTrack CLI 架构重构计划与实施记录（2026-07-31）
- check-skill-lock.test.ts
- cli-entry.ts
- student-task-view.ts
- cli.ts
- hasValue
- workflow-security.test.ts
- logout.test.ts
- Always Ontrack (ontrack-cli)
- login-finalize.ts
- pair-login.ts
- 4. Module 1：Auth lifecycle / security identity
- 5. Module 2：StudentTaskView / task aggregation
- 6. Module 3：Submission lifecycle
- 7. Module 4：Task Planner / date semantics
- 8. Module 5：Production contract discovery + fixture
- compilerOptions
- status.ts
- 4. 分阶段实施
- execution-journal.ts
- Authentication and session management
- Command reference
- agent-execution-engine.ts
- OnTrack CLI domain context
- Always Ontrack (ontrack-cli)
- Local development
- Agent usage
- verify-package.ts
- 3. 真实环境新增或显著强化的产品面
- Pairing Relay 云端免凭证登录（E2E 加密配对 + bookmarklet 抓取）
- pollUntilInterrupted
- Troubleshooting
- Typical workflows
- contracts.test.ts
- 8. 建议的大改方向
- handleNativeAgentCommand
- 4. 真实 API 合同快照
- 7. 前端 route 盘点
- normalizeReadOnlyRoute
- bin
- auto-login-real-browser.test.ts
- submission-upload.ts
- repository
- overrides
- auto-login-browser-adapter.test.ts
- submit-wizard.tsx
- tui/auth.ts
- types.ts
- Core concepts
- task-set-status-cli.test.ts
- agent-call-input.ts

## God Nodes (most connected - your core abstractions)
1. `SessionData` - 65 edges
2. `OnTrackApiClient` - 53 edges
3. `createAuthenticatedApi()` - 49 edges
4. `remoteContractFailure()` - 48 edges
5. `loadProjectsWithTaskMetadata()` - 40 edges
6. `handleLogin()` - 38 edges
7. `main()` - 35 edges
8. `printJson()` - 34 edges
9. `AgentProtocolError` - 33 edges
10. `hasFlag()` - 33 edges

## Surprising Connections (you probably didn't know these)
- `readPersistedSession()` --indirect_call--> `configRoot()`  [INFERRED]
  test/login-finalize.test.ts → src/lib/execution-journal.ts
- `submissionTask()` --calls--> `buildStudentTaskViews()`  [EXTRACTED]
  test/submission-lifecycle.test.ts → src/lib/student-task-view.ts
- `withClient()` --references--> `client`  [EXTRACTED]
  test/auth-mcp.test.ts → scripts/check-gitnexus-mcp.ts
- `assertTuiSmokeFailure()` --calls--> `verifyInstalledTui()`  [EXTRACTED]
  test/verify-package.test.ts → scripts/verify-package.ts
- `systemBrowserAvailable()` --calls--> `resolveBrowserLaunchPlan()`  [EXTRACTED]
  test/auto-login-real-browser.test.ts → src/lib/auto-login.ts

## Import Cycles
- None detected.

## Communities (107 total, 6 thin omitted)

### Community 0 - "agent-project-unit-canonical.ts"
Cohesion: 0.25
Nodes (23): contractAliasedArray(), contractAliasedValue(), contractRecord(), contractSafeText(), requiredContractPositiveInteger(), assertUniqueNumbers(), assertUniqueStrings(), assertUniqueTaskInstances() (+15 more)

### Community 1 - "api.ts"
Cohesion: 0.06
Nodes (58): createNativeAgentExecutionEngine(), handleDoctor(), isForbiddenError(), listUnitsWithFallback(), readAgentFeedbackList(), readAgentFeedbackWatch(), readAgentProjectsList(), readAgentTasksList() (+50 more)

### Community 2 - "utils.ts"
Cohesion: 0.07
Nodes (47): downloadTaskResourceArtifacts(), taskResourceIdentity(), StudentTaskRow, TaskSelector, buildPdfFilename(), buildTaskResourceFilename(), colorize(), COLORS_ENABLED (+39 more)

### Community 3 - "agent-units.ts"
Cohesion: 0.25
Nodes (11): contractPositiveInteger(), contractProjectUnit, AgentUnitShowSource, assertUnitMetadataMatchesProject(), authoritativeProject(), booleanValue(), completeAgentEnvelopeBytes(), createAgentUnitShow() (+3 more)

### Community 4 - "lightpanda-provider.ts"
Cohesion: 0.07
Nodes (35): main(), readPublicOktaUrl(), requiredLightpandaPath(), cleanupFailure(), defaultFileSystem, defaultRuntime, executableValidationError(), hasExited() (+27 more)

### Community 5 - "agent-commands.ts"
Cohesion: 0.04
Nodes (53): AgentAuthStatus, agentFeedbackItemSchema, agentFeedbackListInputSchema, agentFeedbackMultilineTextSchema, agentFeedbackTextSchema, AgentFeedbackWatchInput, agentFeedbackWatchInputSchema, agentFeedbackWatchItemSchema (+45 more)

### Community 6 - "auto-login.ts"
Cohesion: 0.06
Nodes (46): asErrorMessage(), browserInstallHint(), browserLaunchArgs(), BrowserLaunchPlan, BrowserStorageEntry, BrowserStorageState, ClaimedBrowserSessionState, clearSsoBrowserProfile() (+38 more)

### Community 7 - "contracts.ts"
Cohesion: 0.14
Nodes (25): collectUnexpectedKeys(), collectUnsafePayload(), collectUnsafeShapeEnums(), ContractDrift, ContractFixture, ContractFixtureMetadata, ContractProvenance, ContractRisk (+17 more)

### Community 8 - "createAuthenticatedApi"
Cohesion: 0.15
Nodes (54): agentFeedbackListInputFromSelector(), claimConfirmedWrite(), handleAuthEnsure(), handleAuthMethod(), handleAuthStatus(), handleDiscover(), handleFeedbackCommand(), handleFeedbackList() (+46 more)

### Community 9 - "command-spec.ts"
Cohesion: 0.07
Nodes (38): AGENT_TASKS_LIST_MAX_STATUS_LENGTH, agentFeedbackListOutputSchema, agentFeedbackWatchFrameSchema, agentPlanShowInputSchema, agentPlanShowOutputSchema, agentProjectsListInputSchema, agentProjectsListOutputSchema, agentSubmissionStatusOutputSchema (+30 more)

### Community 10 - "agent-task-reads.ts"
Cohesion: 0.06
Nodes (62): AgentSubmissionPdfInput, AgentSubmissionPdfOutput, AgentSubmissionStatusInput, AgentSubmissionStatusOutput, AgentTaskPdfInput, AgentTaskPdfOutput, AgentTaskPrerequisitesInput, AgentTaskPrerequisitesOutput (+54 more)

### Community 11 - "AgentProtocolError"
Cohesion: 0.26
Nodes (9): nonNegativeInteger(), AgentProjectCapabilities, AgentProjectDirectoryItem, booleanValue(), buildAgentProjectsListOutput(), completeAgentEnvelopeBytes(), projectCapabilities(), projectDirectoryItem() (+1 more)

### Community 12 - "remoteContractFailure"
Cohesion: 0.19
Nodes (18): remoteContractFailure(), AgentProjectUnitSource, booleanValue(), canonicalTutorialStatusUnit(), AgentTaskCatalogueItem, AgentTasksListContext, AgentTasksListSource, assertAuthoritativeTaskDefinitions() (+10 more)

### Community 13 - "auth-broker.ts"
Cohesion: 0.14
Nodes (22): readAuthStatus(), AuthBrokerContext, AuthStatusView, brokerSignInDueAt(), brokerStatus(), captureSession(), createOnTrackAuthBroker(), decodeCookieValue() (+14 more)

### Community 14 - "scripts"
Cohesion: 0.07
Nodes (30): scripts, build, build:tui, clean, dev, gitnexus:analyze, gitnexus:check, gitnexus:context (+22 more)

### Community 15 - "discovery.ts"
Cohesion: 0.10
Nodes (33): ProbeResult, API_HINTS, classifyDiscoveredPaths(), contextKeyForParameter(), DEFAULT_DISCOVERY_PROBE_REQUEST_BUDGET, discoverOnTrackSurface(), DiscoveryAsset, DiscoveryResult (+25 more)

### Community 16 - "agent-watch.ts"
Cohesion: 0.10
Nodes (34): agentPlanDateSchema(), AGENT_RFC3339_TIMESTAMP_PATTERN, AGENT_SAFE_TEXT_PATTERN, contractNonNegativeInteger(), contractRfc3339Timestamp(), hasOwnField(), isAgentRfc3339Timestamp(), RFC-3339 (+26 more)

### Community 17 - "auth-mcp-server.ts"
Cohesion: 0.13
Nodes (14): AuthMcpDependencies, configuredBaseUrl(), createAuthMcpServer(), nextActionSchema, serveAuthMcp(), toolResponse(), ToolResult, toolResultSchema (+6 more)

### Community 18 - "OnTrack 真实环境变化审计（2026-07-31）"
Cohesion: 0.11
Nodes (17): 10. 仍需进一步验证的未知项, 11. 与本地代码的直接对应, 12. 本轮实施状态与架构决策入口, 13. 最终实施结果, 1. 审计范围, 2.1 保留的核心合同, 2.2 已经失效或明显不足的核心假设, 2. 总体判断 (+9 more)

### Community 19 - "auth-runtime.ts"
Cohesion: 0.12
Nodes (15): AuthEnsureOptions, AuthInteractionMode, authRequired(), AuthRuntime, AuthRuntimeAdapter, AuthRuntimeResult, createAuthRuntime(), credentialVersionChanged() (+7 more)

### Community 20 - "submission-lifecycle.ts"
Cohesion: 0.11
Nodes (31): buildAgentSubmissionStatusOutput(), PlannerView, StudentTaskReference, booleanValue(), createSubmissionAttempt(), hasOwnField(), InvalidSubmissionDetailsError, isSubmissionObserved() (+23 more)

### Community 21 - "OnTrack CLI CI/CD 设计"
Cohesion: 0.06
Nodes (33): 10. 已决策与管理面 Gates, 11. 官方来源, 1. 结论与范围, 2. 已核对的事实与约束, 3. 目标流水线, 4.1 `.github/workflows/ci.yml`, 4.2 `.github/workflows/dependency-review.yml`, 4.3 `.github/workflows/release.yml` (+25 more)

### Community 22 - "handleLogin"
Cohesion: 0.13
Nodes (24): formatWelcomeMenuRow(), handleLogin(), launcherColor(), launcherColorsEnabled(), renderChallengeNumbersInline(), renderLoginSuccessPanel(), renderTerminalEvent(), renderWelcomeScreen() (+16 more)

### Community 23 - "command-input.ts"
Cohesion: 0.14
Nodes (18): AGENT_GLOBAL_FLAGS, encodeField(), flagOccurrences(), GROUPED_AGENT_COMMANDS, mergeStructuredCommandInput(), parseObject(), readFlagValue(), removeFlagPair() (+10 more)

### Community 24 - "project-catalogue.ts"
Cohesion: 0.17
Nodes (14): AGENT_REMOTE_READ_CONCURRENCY, mapWithConcurrency(), settleWithConcurrency(), AuthFailureKind, classifyAuthFailure(), createSessionFromAccessToken(), migrateLegacySession(), OnTrackHttpError (+6 more)

### Community 25 - "agent-protocol.ts"
Cohesion: 0.15
Nodes (23): AGENT_SCHEMA_VERSION, AgentArtifact, AgentErrorCode, agentErrorEnvelope(), AgentNextAction, AgentOutputContext, AgentProtocolErrorOptions, AgentStatus (+15 more)

### Community 26 - "captureSsoCredentialsInternal"
Cohesion: 0.16
Nodes (22): advanceGuidedSsoOnPage(), BLOCKED_LINK_HOSTS, canUseSelector(), canUseSelectorInScopes(), captureSsoCredentialsInternal(), clickFirstVisible(), clickLikelyActionControl(), collectCredentialScopes() (+14 more)

### Community 27 - "auto-login.test.ts"
Cohesion: 0.14
Nodes (16): clearBrowserSessionState(), clearLegacyBrowserSessionState(), expandSystemBrowserProfileCandidates(), extractCredentialsFromCookieJar(), extractCredentialsFromUrl(), extractMfaNumberChallenge(), extractMfaNumberChallengeFromText(), extractNumberTokens() (+8 more)

### Community 28 - "check-coverage.ts"
Cohesion: 0.22
Nodes (15): assertThreshold(), checkCoverage(), CoverageEvaluation, CoverageMetric, CoverageSummary, CoverageThresholds, evaluateCoverage(), formatMetric() (+7 more)

### Community 29 - "agent-feedback.ts"
Cohesion: 0.09
Nodes (35): AgentFeedbackListInput, AgentFeedbackListOutput, AgentTasksListOutput, AGENT_MULTILINE_SAFE_TEXT_PATTERN, contractSafeMultilineText(), AgentFeedbackItem, AgentFeedbackListSource, AgentFeedbackReadContext (+27 more)

### Community 30 - "package.json"
Cohesion: 0.12
Nodes (16): bugs, url, description, engines, files, homepage, license, name (+8 more)

### Community 31 - "compilerOptions"
Cohesion: 0.11
Nodes (18): node_modules, src/**/*.ts, src/tui, compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution (+10 more)

### Community 32 - "OnTrack CLI Agent-Ready 实施计划"
Cohesion: 0.07
Nodes (26): 10. 测试矩阵, 11. 发布判断, 1. 产品定位, 2. 核心架构, 3. 不变量, 4.1 成功响应, 4.2 错误与暂停响应, 4. Agent 协议 (+18 more)

### Community 33 - "data.ts"
Cohesion: 0.17
Nodes (16): nonBlankStringValue(), numberValue(), stringValue(), toWhoAmIView(), WhoAmIView, bucketStatus(), createOnTrackTaskLoader(), daysUntil() (+8 more)

### Community 34 - "utils-coverage.test.ts"
Cohesion: 0.18
Nodes (30): buildInboxFallbackTasksFromProjectDetails(), dedupeInboxTasks(), extractInboxProjectId(), flattenTasks(), handleInbox(), handleTasks(), handleTaskShow(), handleUnitTasks() (+22 more)

### Community 35 - "session.ts"
Cohesion: 0.15
Nodes (22): defaultDependencies(), handleLogout(), reportAuthDiagnosticToStderr(), clearAllBrowserSessionState(), AcquiredSessionRefreshLock, acquireSessionRefreshLock(), clearSession(), getConfigRoot() (+14 more)

### Community 36 - ".run"
Cohesion: 0.21
Nodes (11): captureCredentialsFromPersistedStateFile(), captureCredentialsFromStoredBrowserSession(), captureCredentialsFromSystemBrowserProfile(), closeBrowserAtMost(), extractCredentialsFromRequestHeaders(), isTargetOnTrackAuthUrl(), isTargetOnTrackUrl(), openThrowawaySsoCapture() (+3 more)

### Community 37 - "persistRefreshCookie"
Cohesion: 0.30
Nodes (17): assertTrustedBrowserSessionStateDirectory(), buildContextOptionsWithStoredSession(), claimBrowserSessionState(), filterBrowserSessionState(), hasReusableBrowserSessionState(), isBrowserStorageState(), persistRefreshCookie(), publishCapturedBrowserSessionState() (+9 more)

### Community 38 - "app.tsx"
Cohesion: 0.11
Nodes (23): isFilesRequiredRejection(), App(), Command, dueBadge(), fuzzyMatch(), Header(), matches(), Mode (+15 more)

### Community 39 - "check-skill-lock.ts"
Cohesion: 0.31
Nodes (9): collectFiles(), computeSkillFolderHash(), HashedFile, isRecord(), listInstalledSkillNames(), main(), parseLock(), SkillLock (+1 more)

### Community 40 - "smoke-tui.tsx"
Cohesion: 0.09
Nodes (15): attemptKeys, confirmLoginMethod(), expiredSubmit, flakyLoad(), hangingExtras, okSubmit, openWizard(), pasteSubmitActions (+7 more)

### Community 41 - "loadProjectsWithTaskMetadata"
Cohesion: 0.28
Nodes (9): buildWatchSnapshot(), readAgentPlanShow(), readWatchComments(), rethrowWatchAuthFailure(), readAgentSubmissionStatus(), getUnitTaskDefinitions(), loadProjectsWithTaskMetadata(), projectMatchesScope() (+1 more)

### Community 42 - "smoke-real.mjs"
Cohesion: 0.50
Nodes (7): main(), parseArgs(), pickFirstTask(), run(), runFeedbackWatch(), runJson(), runWatch()

### Community 43 - "devDependencies"
Cohesion: 0.29
Nodes (7): devDependencies, @types/node, @types/react, typescript, @types/node, @types/react, typescript

### Community 44 - "dependencies"
Cohesion: 0.15
Nodes (13): @modelcontextprotocol/sdk, @opentui/core, @opentui/react, dependencies, @modelcontextprotocol/sdk, @opentui/core, @opentui/react, playwright-core (+5 more)

### Community 45 - "agent-plan.ts"
Cohesion: 0.12
Nodes (37): AgentPlanShowInput, aliasValues(), buildAgentPlanShowOutput(), calendarDate(), normalizePrerequisites(), own(), pairedArray(), pairedBoolean() (+29 more)

### Community 46 - "keywords"
Cohesion: 0.33
Nodes (6): keywords, agent, cli, doubtfire, mcp, ontrack

### Community 47 - "watch-snapshots.ts"
Cohesion: 0.20
Nodes (15): AgentPlanShowOutput, AgentWatchState, getLatestFeedbackTimestamp(), makeWatchTaskKey(), WatchTaskState, agentWatchStateForPlanTask(), agentWatchStateMap(), buildAgentWatchSnapshots() (+7 more)

### Community 51 - "OnTrack CLI 架构重构计划与实施记录（2026-07-31）"
Cohesion: 0.12
Nodes (17): 10. 完成定义, 11. 2026-07-31 实施完成记录, 1.1 重构目标, 1.2 强制术语, 1.3 不变量, 1. 目标、术语与约束, 2.1 真实环境证据, 2.2 当前源码中的耦合 (+9 more)

### Community 53 - "cli-entry.ts"
Cohesion: 0.40
Nodes (3): CliEntryResolution, CliTerminalState, resolveCliEntry()

### Community 54 - "student-task-view.ts"
Cohesion: 0.14
Nodes (26): BuildStudentTaskViewOptions, buildStudentTaskViews(), definitionsForProject(), definitionTargetGrade(), definitionTutorialStream(), embeddedDefinition(), enrolledTutorialStreams(), includeVisibility() (+18 more)

### Community 55 - "cli.ts"
Cohesion: 0.06
Nodes (60): agentSubmissionStatusInputFromSelector(), applyLimit(), arrayLength(), buildTaskSelectorArgs(), countTasksByStatus(), deriveUnitsFromProjects(), describeWatchEvent(), DIGITAL_LOGO_LINES (+52 more)

### Community 56 - "hasValue"
Cohesion: 0.22
Nodes (15): extractCredentialsFromAuthPayload(), extractCredentialsFromLocalStorage(), extractCredentialsFromStorageEntries(), extractCredentialsFromUnknownObject(), extractUsernameFromUserRecord(), guardLoginTokenExchange(), hasValue(), isBrowserStorageCookie() (+7 more)

### Community 60 - "Always Ontrack (ontrack-cli)"
Cohesion: 0.12
Nodes (17): Agent-first 使用方式, Always Ontrack (ontrack-cli), 功能概览, 原生 caller-first 接口, 原生命令目录, 发现协议, 命令参考, 安装 (+9 more)

### Community 61 - "login-finalize.ts"
Cohesion: 0.14
Nodes (18): AuthDiagnostic, persistRefreshCookieBestEffort(), REFRESH_COOKIE_PERSISTENCE_DIAGNOSTIC, finalizeCapturedLogin(), PairedCredentialRejectedError, persistCapturedRefreshCookie(), sessionFromAccessTokenCapture(), sessionFromExchange() (+10 more)

### Community 62 - "pair-login.ts"
Cohesion: 0.08
Nodes (34): base64UrlDecode(), base64UrlEncode(), capturedMaterialFromPairPayload(), decryptFromBrowser(), DEFAULT_RELAY_URL, deriveMailboxId(), deriveSharedAesKey(), encryptForCli() (+26 more)

### Community 63 - "4. Module 1：Auth lifecycle / security identity"
Cohesion: 0.25
Nodes (8): 4.1 证据与当前耦合, 4.2 目标责任与 Depth, 4.3 Interface 决策门（不冻结签名）, 4.4 Seam 与 Adapter, 4.5 可删除的 Implementation, 4.6 迁移与验证, 4.7 回滚、风险、验收与 deletion test, 4. Module 1：Auth lifecycle / security identity

### Community 64 - "5. Module 2：StudentTaskView / task aggregation"
Cohesion: 0.25
Nodes (8): 5.1 证据与当前耦合, 5.2 目标责任与 Depth, 5.3 Interface 决策门（不冻结签名）, 5.4 Seam 与 Adapter, 5.5 可删除的 Implementation, 5.6 迁移与验证, 5.7 回滚、风险、验收与 deletion test, 5. Module 2：StudentTaskView / task aggregation

### Community 65 - "6. Module 3：Submission lifecycle"
Cohesion: 0.25
Nodes (8): 6.1 证据与当前耦合, 6.2 目标责任与 Depth, 6.3 Interface 决策门（不冻结签名）, 6.4 Seam 与 Adapter, 6.5 可删除的 Implementation, 6.6 迁移与验证, 6.7 回滚、风险、验收与 deletion test, 6. Module 3：Submission lifecycle

### Community 66 - "7. Module 4：Task Planner / date semantics"
Cohesion: 0.25
Nodes (8): 7.1 证据与当前耦合, 7.2 目标责任与 Depth, 7.3 Interface 决策门（不冻结签名）, 7.4 Seam 与 Adapter, 7.5 可删除的 Implementation, 7.6 迁移与验证, 7.7 回滚、风险、验收与 deletion test, 7. Module 4：Task Planner / date semantics

### Community 67 - "8. Module 5：Production contract discovery + fixture"
Cohesion: 0.25
Nodes (8): 8.1 证据与当前耦合, 8.2 目标责任与 Depth, 8.3 Interface 决策门（不冻结签名）, 8.4 Seam 与 Adapter, 8.5 可删除的 Implementation, 8.6 迁移与验证, 8.7 回滚、风险、验收与 deletion test, 8. Module 5：Production contract discovery + fixture

### Community 68 - "compilerOptions"
Cohesion: 0.10
Nodes (19): DOM, ESNext, src/tui/**/*.ts, src/tui/**/*.tsx, compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, jsx (+11 more)

### Community 69 - "status.ts"
Cohesion: 0.23
Nodes (6): DEFAULT_AUTH_MIN_TTL_SECONDS, ApplyStatusTriggerOutcome, SetStatusOutcome, SetStatusRunner, TaskExtrasActions, TuiTask

### Community 70 - "4. 分阶段实施"
Cohesion: 0.12
Nodes (16): 1. 定位与原则, 2. 分支与 PR 策略, 3. 目标架构, 4. 分阶段实施, 5. 待决技术决策, 6. 风险与缓解, OnTrack TUI 全面实施计划, Phase 0 — 分支整理与骨架 PR (+8 more)

### Community 71 - "execution-journal.ts"
Cohesion: 0.21
Nodes (19): sanitizeAgentData(), atomicWrite(), claimExecution(), configRoot(), digest(), ExecutionClaim, executionFingerprint(), ExecutionJournalOptions (+11 more)

### Community 72 - "Authentication and session management"
Cohesion: 0.12
Nodes (16): Authentication and session management, Browser capture: `--auto`, `--show-browser`, `--hide-browser`, Browser refresh state location, Direct token login, How long a paired session lasts, and why it cannot last longer, Login flow output, Logout, Manual redirect import (backup only) (+8 more)

### Community 73 - "Command reference"
Cohesion: 0.15
Nodes (13): Account and connectivity, Command reference, Default output, Diagnostics and discovery, Download directory, Feedback and live tracking, Force colors on or off, Interactive terminal interfaces (+5 more)

### Community 74 - "agent-execution-engine.ts"
Cohesion: 0.10
Nodes (25): AgentBasePolicy, AgentCallRequest, AgentCommandDefinition, AgentCommandManifest, AgentCommandPolicy, AgentExecutionEngineOptions, AgentExecutionEnvelope, AgentNonWritePolicy (+17 more)

### Community 75 - "OnTrack CLI domain context"
Cohesion: 0.29
Nodes (6): Identity, OnTrack CLI domain context, Planning, Production contracts, Student work, Submission

### Community 76 - "Always Ontrack (ontrack-cli)"
Cohesion: 0.12
Nodes (17): Agent-first usage, Always Ontrack (ontrack-cli), Authentication, Command reference, Contents, Current scope, Development, Discover the protocol (+9 more)

### Community 77 - "Local development"
Cohesion: 0.20
Nodes (10): Build, Coverage thresholds, Development, Development runs, Install dependencies, Lightpanda experiment, Local development, Real-account smoke verification (+2 more)

### Community 78 - "Agent usage"
Cohesion: 0.22
Nodes (9): Agent execution journal, Agent usage, Agent watch streams, Apply writes safely, Discover the protocol, Native caller-first interface, Pass structured input, Per-command behavior (+1 more)

### Community 79 - "verify-package.ts"
Cohesion: 0.08
Nodes (39): bun, client, expectedTools, transport, assertChildPath(), assertRegularTree(), createTuiCapture(), exitsWithin() (+31 more)

### Community 80 - "3. 真实环境新增或显著强化的产品面"
Cohesion: 0.22
Nodes (9): 3.1 品牌与全局导航, 3.2 Project Dashboard, 3.3 Task Details, 3.4 Task Planner, 3.5 Submission 工作流, 3.6 Portfolio, 3.7 Tutorials 与 Groups, 3.8 Profile、Calendar 与 QR (+1 more)

### Community 81 - "Pairing Relay 云端免凭证登录（E2E 加密配对 + bookmarklet 抓取）"
Cohesion: 0.22
Nodes (8): A. 本仓库（ontrack-cli）, B. 新仓库 `ontrack-pair-relay`（独立仓库，本地脚手架建在 `/Users/mark/ontrack-pair-relay`，即本仓库的**同级目录**——在工作目录之外，执行时需用户确认）, Pairing Relay 云端免凭证登录（E2E 加密配对 + bookmarklet 抓取）, 协议设计（单方案）, 改动清单, 明确不做（本次范围外）, 目标, 验证

### Community 84 - "Troubleshooting"
Cohesion: 0.22
Nodes (9): `419 Authentication Timeout`, `Error: 403 Forbidden: Unable to list units`, `Inbox endpoint unavailable ... Showing fallback task list`, `No browser executable found ...`, No color highlighting, Okta asks for MFA or a number challenge on every login, `Task abbreviation "... " is ambiguous`, Troubleshooting (+1 more)

### Community 85 - "Typical workflows"
Cohesion: 0.25
Nodes (8): Difference between `submission upload` and `submission upload-new-files`, Typical workflows, Upload matching rules, Workflow 1: sign in and find your tasks, Workflow 2: inspect one task end to end, Workflow 3: watch live conversation and status changes, Workflow 4: download PDFs, Workflow 5: upload a submission

### Community 86 - "contracts.test.ts"
Cohesion: 0.20
Nodes (10): collectShapeDrift(), diffContractShapes(), enumText(), loadContractFixture(), normalizeProductionPayload(), normalizeValue(), SAFE_ENUM_FIELDS, sanitizeProductionPayload() (+2 more)

### Community 87 - "8. 建议的大改方向"
Cohesion: 0.33
Nodes (6): 8. 建议的大改方向, Phase 0：安全与认证（先做）, Phase 1：重建领域聚合层, Phase 2：重新设计 CLI 命令面, Phase 3：提交与反馈生命周期, Phase 4：角色与高级模块

### Community 88 - "handleNativeAgentCommand"
Cohesion: 0.29
Nodes (6): handleNativeAgentCommand(), normalizeAgentCliError(), writeNativeAgentStream(), AgentExecutionEngine, defineAgentStreamCommand(), exitCodeForAgentEnvelope()

### Community 89 - "4. 真实 API 合同快照"
Cohesion: 0.40
Nodes (5): 4.1 认证, 4.2 Project summary 与 project detail, 4.3 Unit detail 成为任务目录的主要来源, 4.4 新增/关键 endpoint, 4. 真实 API 合同快照

### Community 90 - "7. 前端 route 盘点"
Cohesion: 0.50
Nodes (4): 7. 前端 route 盘点, Staff/管理端（仅 bundle 发现，未验证权限）, Student 主流程, Task/教学扩展

### Community 91 - "normalizeReadOnlyRoute"
Cohesion: 0.50
Nodes (4): canonicalRoute(), normalizeReadOnlyRoute(), READ_ONLY_METHODS, ROUTE_CATALOG

### Community 92 - "bin"
Cohesion: 0.67
Nodes (3): bin, ontrack, ontrack-auth-mcp

### Community 93 - "auto-login-real-browser.test.ts"
Cohesion: 0.19
Nodes (13): candidateBrowserPaths(), captureSsoCredentials(), resolveBrowserLaunchPlan(), resolveLightpandaExecutable(), browserLogin(), browserTest, cookieValue(), Exchange (+5 more)

### Community 94 - "submission-upload.ts"
Cohesion: 0.21
Nodes (16): resolveStudentTaskViews(), SubmissionAttemptState, applySubmissionUpload(), ApplySubmissionUploadInput, deriveDefaultSubmissionTrigger(), parseSubmissionTrigger(), readUploadFiles(), resolveSelectedStudentTask() (+8 more)

### Community 96 - "repository"
Cohesion: 0.67
Nodes (3): repository, type, url

### Community 97 - "overrides"
Cohesion: 0.50
Nodes (4): overrides, adm-zip, js-yaml, sharp

### Community 98 - "auto-login-browser-adapter.test.ts"
Cohesion: 0.12
Nodes (9): BrowserLaunchAdapter, setBrowserSessionStatePathForTests(), setSsoBrowserProfileDirForTests(), FakeBrowserOptions, Handler, PersistentLaunch, withSsoProfileDir(), browserStateEnvironmentTail (+1 more)

### Community 100 - "submit-wizard.tsx"
Cohesion: 0.14
Nodes (13): SubmitActions, SubmitOutcome, humanizeBytes(), slotsFor(), SPINNER, Stage, SubmitWizard(), TRIGGER_CHOICES (+5 more)

### Community 104 - "tui/auth.ts"
Cohesion: 0.10
Nodes (26): AuthDiagnosticSink, MfaMethodOption, SsoFallbackReason, SsoStep, availableLoginMethods(), defaultLoginMethod(), LOGIN_METHOD_CHOICES, LOGIN_METHOD_NUMBER (+18 more)

### Community 105 - "types.ts"
Cohesion: 0.17
Nodes (13): CapturedSignIn, LoginCredentials, CapturedLoginMaterial, CredentialContract, CredentialSource, OnTrackUser, RefreshCookieMaterial, TaskBatchSelector (+5 more)

### Community 106 - "Core concepts"
Cohesion: 0.25
Nodes (8): `abbr`, Batch task selectors, Core concepts, `--json`, `project`, `task`, `taskDefinitionId`, `unit`

### Community 107 - "task-set-status-cli.test.ts"
Cohesion: 0.31
Nodes (6): baseArgs, projectPayload(), sendJson(), statusHandler(), StatusPutBehavior, unitPayload()

### Community 108 - "agent-call-input.ts"
Cohesion: 0.43
Nodes (6): AgentCallInputDependencies, AgentCallInvocation, invalidArgument(), parseAgentCallInvocation(), parseInputObject(), readProcessStdin()

## Knowledge Gaps
- **603 isolated node(s):** `name`, `version`, `description`, `license`, `type` (+598 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `client` connect `verify-package.ts` to `auth-mcp-server.ts`?**
  _High betweenness centrality (0.080) - this node is a cross-community bridge._
- **Why does `withClient()` connect `auth-mcp-server.ts` to `verify-package.ts`?**
  _High betweenness centrality (0.079) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _603 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `api.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05641592920353982 - nodes in this community are weakly interconnected._
- **Should `utils.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06938775510204082 - nodes in this community are weakly interconnected._
- **Should `lightpanda-provider.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06988120195667366 - nodes in this community are weakly interconnected._
- **Should `agent-commands.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.03636363636363636 - nodes in this community are weakly interconnected._