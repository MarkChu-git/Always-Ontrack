# Graph Report - unruffled-nightingale-04e31d  (2026-10-08)

## Corpus Check
- 151 files · ~211,309 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2172 nodes · 5574 edges · 107 communities (102 shown, 5 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 51 edges (avg confidence: 0.58)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `1be398d4`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- remoteContractFailure
- api.ts
- utils.ts
- promptTaskSelectorFromTaskList
- lightpanda-provider.ts
- agent-commands.ts
- auto-login.ts
- contracts.ts
- main
- command-spec.ts
- agent-task-reads.ts
- agent-projects.ts
- agent-tasks.ts
- auth-broker.ts
- scripts
- discovery.ts
- agent-watch.ts
- auth-mcp-server.ts
- OnTrack 真实环境变化审计（2026-07-31）
- auth-runtime.ts
- submission-upload.ts
- OnTrack CLI CI/CD 设计
- handleLogin
- command-input.ts
- lib/auth.ts
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
- createAuthenticatedApi
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
- auto-login-session-reuse.test.ts
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
- TuiTask
- 4. 分阶段实施
- planner.ts
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
- handleTaskStatus
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
- project-catalogue.ts
- OnTrackAuthBroker
- repository
- overrides
- auto-login-browser-adapter.test.ts
- task-extras.ts
- tui/auth.ts
- Core concepts
- task-set-status-cli.test.ts
- agent-call-input.ts

## God Nodes (most connected - your core abstractions)
1. `SessionData` - 65 edges
2. `OnTrackApiClient` - 53 edges
3. `createAuthenticatedApi()` - 49 edges
4. `remoteContractFailure()` - 48 edges
5. `loadProjectsWithTaskMetadata()` - 40 edges
6. `handleLogin()` - 37 edges
7. `main()` - 35 edges
8. `printJson()` - 34 edges
9. `AgentProtocolError` - 33 edges
10. `hasFlag()` - 33 edges

## Surprising Connections (you probably didn't know these)
- `readPersistedSession()` --indirect_call--> `configRoot()`  [INFERRED]
  test/login-finalize.test.ts → src/lib/execution-journal.ts
- `assertTuiSmokeFailure()` --calls--> `verifyInstalledTui()`  [EXTRACTED]
  test/verify-package.test.ts → scripts/verify-package.ts
- `systemBrowserAvailable()` --calls--> `resolveBrowserLaunchPlan()`  [EXTRACTED]
  test/auto-login-real-browser.test.ts → src/lib/auto-login.ts
- `browserLogin()` --calls--> `finalizeCapturedLogin()`  [EXTRACTED]
  test/auto-login-real-browser.test.ts → src/lib/login-finalize.ts
- `submissionTask()` --calls--> `buildStudentTaskViews()`  [EXTRACTED]
  test/submission-lifecycle.test.ts → src/lib/student-task-view.ts

## Import Cycles
- None detected.

## Communities (107 total, 5 thin omitted)

### Community 0 - "remoteContractFailure"
Cohesion: 0.15
Nodes (44): AGENT_SAFE_TEXT_PATTERN, contractAliasedArray(), contractAliasedValue(), contractNonNegativeInteger(), contractPositiveInteger(), contractProjectUnit, contractRecord(), contractSafeText() (+36 more)

### Community 1 - "api.ts"
Cohesion: 0.05
Nodes (59): handleDoctor(), authHeaders(), AuthSessionRefresh, buildErrorMessage(), CapturedSignIn, contentDispositionFilename(), extractRefreshCookieFromHeaders(), fetchOnTrack() (+51 more)

### Community 2 - "utils.ts"
Cohesion: 0.08
Nodes (44): buildStudentTaskRows(), StudentTaskRow, colorize(), COLORS_ENABLED, DEFAULT_DOWNLOAD_DIR, ExternalOpenCommand, feedbackIdentity(), feedbackIdValue() (+36 more)

### Community 3 - "promptTaskSelectorFromTaskList"
Cohesion: 0.14
Nodes (24): buildTaskSelectorArgs(), expandHomePath(), handleWelcome(), panelBodyCode(), panelToneCode(), panelVisibleLength(), parseTaskSelectorTokens(), promptExternalArtifactAuthorization() (+16 more)

### Community 4 - "lightpanda-provider.ts"
Cohesion: 0.07
Nodes (35): main(), readPublicOktaUrl(), requiredLightpandaPath(), cleanupFailure(), defaultFileSystem, defaultRuntime, executableValidationError(), hasExited() (+27 more)

### Community 5 - "agent-commands.ts"
Cohesion: 0.04
Nodes (51): AgentAuthStatus, agentFeedbackItemSchema, agentFeedbackListInputSchema, agentFeedbackMultilineTextSchema, agentFeedbackTextSchema, agentFeedbackWatchInputSchema, agentFeedbackWatchItemSchema, agentFeedbackWatchOptions (+43 more)

### Community 6 - "auto-login.ts"
Cohesion: 0.07
Nodes (43): BrowserLaunchPlan, BrowserStorageEntry, BrowserStorageState, ClaimedBrowserSessionState, clearAllBrowserSessionState(), clearBrowserSessionState(), clearLegacyBrowserSessionState(), clearSsoBrowserProfile() (+35 more)

### Community 7 - "contracts.ts"
Cohesion: 0.14
Nodes (25): collectUnexpectedKeys(), collectUnsafePayload(), collectUnsafeShapeEnums(), ContractDrift, ContractFixture, ContractFixtureMetadata, ContractProvenance, ContractRisk (+17 more)

### Community 8 - "main"
Cohesion: 0.19
Nodes (36): agentFeedbackListInputFromSelector(), handleAuthStatus(), handleDiscover(), handleFeedbackCommand(), handleFeedbackList(), handleFeedbackWatch(), handleLogout(), handlePdfCommand() (+28 more)

### Community 9 - "command-spec.ts"
Cohesion: 0.07
Nodes (37): AGENT_TASKS_LIST_MAX_STATUS_LENGTH, agentFeedbackListOutputSchema, agentFeedbackWatchFrameSchema, agentPlanShowInputSchema, agentPlanShowOutputSchema, agentProjectsListInputSchema, agentProjectsListOutputSchema, agentSubmissionStatusOutputSchema (+29 more)

### Community 10 - "agent-task-reads.ts"
Cohesion: 0.09
Nodes (35): AgentSubmissionPdfInput, AgentSubmissionPdfOutput, AgentSubmissionStatusInput, AgentSubmissionStatusOutput, AgentTaskPdfInput, AgentTaskPdfOutput, AgentTaskPrerequisitesInput, AgentTaskPrerequisitesOutput (+27 more)

### Community 11 - "agent-projects.ts"
Cohesion: 0.36
Nodes (7): AgentProjectCapabilities, AgentProjectDirectoryItem, booleanValue(), buildAgentProjectsListOutput(), completeAgentEnvelopeBytes(), projectCapabilities(), projectDirectoryItem()

### Community 12 - "agent-tasks.ts"
Cohesion: 0.13
Nodes (21): AgentTasksListInput, AgentTasksListOutput, AgentProjectUnitSource, booleanValue(), canonicalTutorialStatusUnit(), AgentProtocolError, AgentTaskCatalogueItem, AgentTasksListContext (+13 more)

### Community 13 - "auth-broker.ts"
Cohesion: 0.12
Nodes (26): AuthBrokerContext, AuthStatusView, brokerSignInDueAt(), brokerStatus(), captureSession(), createBrokerContext(), createOnTrackAuthBroker(), decodeCookieValue() (+18 more)

### Community 14 - "scripts"
Cohesion: 0.07
Nodes (30): scripts, build, build:tui, clean, dev, gitnexus:analyze, gitnexus:check, gitnexus:context (+22 more)

### Community 15 - "discovery.ts"
Cohesion: 0.10
Nodes (33): ProbeResult, API_HINTS, classifyDiscoveredPaths(), contextKeyForParameter(), DEFAULT_DISCOVERY_PROBE_REQUEST_BUDGET, discoverOnTrackSurface(), DiscoveryAsset, DiscoveryResult (+25 more)

### Community 16 - "agent-watch.ts"
Cohesion: 0.10
Nodes (28): agentPlanDateSchema(), AGENT_RFC3339_TIMESTAMP_PATTERN, contractRfc3339Timestamp(), isAgentRfc3339Timestamp(), AgentWatchDate, AgentWatchDateKind, agentWatchDateSchema, AgentWatchDateSource (+20 more)

### Community 17 - "auth-mcp-server.ts"
Cohesion: 0.12
Nodes (17): client, expectedTools, transport, AuthMcpDependencies, configuredBaseUrl(), createAuthMcpServer(), defaultDependencies(), nextActionSchema (+9 more)

### Community 18 - "OnTrack 真实环境变化审计（2026-07-31）"
Cohesion: 0.11
Nodes (17): 10. 仍需进一步验证的未知项, 11. 与本地代码的直接对应, 12. 本轮实施状态与架构决策入口, 13. 最终实施结果, 1. 审计范围, 2.1 保留的核心合同, 2.2 已经失效或明显不足的核心假设, 2. 总体判断 (+9 more)

### Community 19 - "auth-runtime.ts"
Cohesion: 0.14
Nodes (13): AuthInteractionMode, authRequired(), AuthRuntime, AuthRuntimeAdapter, createAuthRuntime(), credentialVersionChanged(), inFlightKey(), isFreshEnough() (+5 more)

### Community 20 - "submission-upload.ts"
Cohesion: 0.05
Nodes (84): ArtifactOutputOptions, ArtifactPathOptions, ArtifactSafetyError, assertCleanPathInput(), assertNoSymbolicLinkComponents(), assertSafeFilename(), findExternalArtifactPaths(), inspectUploadFile() (+76 more)

### Community 21 - "OnTrack CLI CI/CD 设计"
Cohesion: 0.06
Nodes (33): 10. 已决策与管理面 Gates, 11. 官方来源, 1. 结论与范围, 2. 已核对的事实与约束, 3. 目标流水线, 4.1 `.github/workflows/ci.yml`, 4.2 `.github/workflows/dependency-review.yml`, 4.3 `.github/workflows/release.yml` (+25 more)

### Community 22 - "handleLogin"
Cohesion: 0.15
Nodes (20): handleAuthMethod(), handleLogin(), promptLoginMethod(), ssoRedirectUrl(), defaultLoginMethod(), parseLoginMethodChoice(), resolveLoginMethod(), shouldPromptLoginMethod() (+12 more)

### Community 23 - "command-input.ts"
Cohesion: 0.14
Nodes (18): AGENT_GLOBAL_FLAGS, encodeField(), flagOccurrences(), GROUPED_AGENT_COMMANDS, mergeStructuredCommandInput(), parseObject(), readFlagValue(), removeFlagPair() (+10 more)

### Community 24 - "lib/auth.ts"
Cohesion: 0.23
Nodes (8): AuthFailureKind, classifyAuthFailure(), migrateLegacySession(), OnTrackHttpError, OnTrackTransportError, sessionUsability, AccessTokenResponse, legacy

### Community 25 - "agent-protocol.ts"
Cohesion: 0.14
Nodes (25): AGENT_SCHEMA_VERSION, AgentArtifact, AgentErrorCode, agentErrorEnvelope(), AgentNextAction, AgentOutputContext, AgentProtocolErrorOptions, AgentStatus (+17 more)

### Community 26 - "captureSsoCredentialsInternal"
Cohesion: 0.12
Nodes (26): advanceGuidedSsoOnPage(), BLOCKED_LINK_HOSTS, canUseSelector(), canUseSelectorInScopes(), captureSsoCredentialsInternal(), clickFirstVisible(), clickLikelyActionControl(), collectCredentialScopes() (+18 more)

### Community 27 - "auto-login.test.ts"
Cohesion: 0.15
Nodes (19): classifySsoFallback(), expandSystemBrowserProfileCandidates(), extractCredentialsFromAuthPayload(), extractCredentialsFromCookieJar(), extractCredentialsFromLocalStorage(), extractCredentialsFromStorageEntries(), extractCredentialsFromUnknownObject(), extractCredentialsFromUrl() (+11 more)

### Community 28 - "check-coverage.ts"
Cohesion: 0.22
Nodes (15): assertThreshold(), checkCoverage(), CoverageEvaluation, CoverageMetric, CoverageSummary, CoverageThresholds, evaluateCoverage(), formatMetric() (+7 more)

### Community 29 - "agent-feedback.ts"
Cohesion: 0.10
Nodes (32): AgentFeedbackListInput, AgentFeedbackListOutput, AgentFeedbackWatchInput, AGENT_MULTILINE_SAFE_TEXT_PATTERN, contractSafeMultilineText(), AgentFeedbackItem, AgentFeedbackListSource, AgentFeedbackReadContext (+24 more)

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
Cohesion: 0.24
Nodes (13): nonBlankStringValue(), numberValue(), stringValue(), toWhoAmIView(), WhoAmIView, bucketStatus(), createOnTrackTaskLoader(), daysUntil() (+5 more)

### Community 34 - "utils-coverage.test.ts"
Cohesion: 0.19
Nodes (26): buildInboxFallbackTasksFromProjectDetails(), countTasksByStatus(), dedupeInboxTasks(), extractInboxProjectId(), flattenTasks(), handleAuthEnsure(), handleInbox(), handleProjectCommand() (+18 more)

### Community 35 - "session.ts"
Cohesion: 0.20
Nodes (15): AcquiredSessionRefreshLock, acquireSessionRefreshLock(), clearSession(), getConfigRoot(), getSessionPath(), isNodeError(), recoverStaleRefreshLock(), resolveSessionPath() (+7 more)

### Community 36 - ".run"
Cohesion: 0.15
Nodes (18): asErrorMessage(), browserInstallHint(), browserLaunchArgs(), captureCredentialsFromPersistedStateFile(), captureCredentialsFromStoredBrowserSession(), captureCredentialsFromSystemBrowserProfile(), closeBrowserAtMost(), extractCredentialsFromRequestHeaders() (+10 more)

### Community 37 - "persistRefreshCookie"
Cohesion: 0.24
Nodes (20): assertTrustedBrowserSessionStateDirectory(), buildContextOptionsWithStoredSession(), claimBrowserSessionState(), filterBrowserSessionState(), hasReusableBrowserSessionState(), isBrowserStorageCookie(), isBrowserStorageOrigin(), isBrowserStorageState() (+12 more)

### Community 38 - "app.tsx"
Cohesion: 0.08
Nodes (30): DEFAULT_AUTH_MIN_TTL_SECONDS, App(), Command, dueBadge(), fuzzyMatch(), Header(), matches(), Mode (+22 more)

### Community 39 - "check-skill-lock.ts"
Cohesion: 0.31
Nodes (9): collectFiles(), computeSkillFolderHash(), HashedFile, isRecord(), listInstalledSkillNames(), main(), parseLock(), SkillLock (+1 more)

### Community 40 - "smoke-tui.tsx"
Cohesion: 0.08
Nodes (17): attemptKeys, confirmLoginMethod(), expiredSubmit, flakyLoad(), hangingExtras, okSubmit, openWizard(), pasteSubmitActions (+9 more)

### Community 41 - "createAuthenticatedApi"
Cohesion: 0.20
Nodes (21): arrayLength(), createNativeAgentExecutionEngine(), handleUnitCommand(), handleUnitShow(), normalizeAgentCliError(), readAgentFeedbackList(), readAgentFeedbackTarget(), readAgentFeedbackWatch() (+13 more)

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
Cohesion: 0.30
Nodes (18): AgentPlanShowInput, aliasValues(), buildAgentPlanShowOutput(), calendarDate(), normalizePrerequisites(), own(), pairedArray(), pairedBoolean() (+10 more)

### Community 46 - "keywords"
Cohesion: 0.33
Nodes (6): keywords, agent, cli, doubtfire, mcp, ontrack

### Community 47 - "watch-snapshots.ts"
Cohesion: 0.23
Nodes (13): AgentPlanShowOutput, AgentWatchState, getLatestFeedbackTimestamp(), makeWatchTaskKey(), WatchTaskState, agentWatchStateForPlanTask(), buildAgentWatchSnapshots(), buildLegacyWatchSnapshots() (+5 more)

### Community 50 - "createNativeAgentCommands"
Cohesion: 0.21
Nodes (3): createNativeAgentCommands(), NativeAgentCommandHandlers, AgentStreamContext

### Community 51 - "OnTrack CLI 架构重构计划与实施记录（2026-07-31）"
Cohesion: 0.12
Nodes (17): 10. 完成定义, 11. 2026-07-31 实施完成记录, 1.1 重构目标, 1.2 强制术语, 1.3 不变量, 1. 目标、术语与约束, 2.1 真实环境证据, 2.2 当前源码中的耦合 (+9 more)

### Community 53 - "cli-entry.ts"
Cohesion: 0.40
Nodes (3): CliEntryResolution, CliTerminalState, resolveCliEntry()

### Community 54 - "student-task-view.ts"
Cohesion: 0.16
Nodes (23): BuildStudentTaskViewOptions, buildStudentTaskViews(), definitionsForProject(), definitionTargetGrade(), definitionTutorialStream(), embeddedDefinition(), enrolledTutorialStreams(), includeVisibility() (+15 more)

### Community 55 - "cli.ts"
Cohesion: 0.06
Nodes (55): agentSubmissionStatusInputFromSelector(), applyLimit(), buildWatchSnapshot(), deriveUnitsFromProjects(), describeWatchEvent(), DIGITAL_LOGO_LINES, DoctorCheck, feedbackAuthor() (+47 more)

### Community 56 - "auto-login-session-reuse.test.ts"
Cohesion: 0.20
Nodes (7): guardLoginTokenExchange(), isLoginTokenExchange(), isTokenExchangeUrl(), readStoredRefreshCookie(), setBrowserSessionStatePathForTests(), browserStateEnvironmentTail, withBrowserState()

### Community 60 - "Always Ontrack (ontrack-cli)"
Cohesion: 0.12
Nodes (17): Agent-first 使用方式, Always Ontrack (ontrack-cli), 功能概览, 原生 caller-first 接口, 原生命令目录, 发现协议, 命令参考, 安装 (+9 more)

### Community 61 - "login-finalize.ts"
Cohesion: 0.15
Nodes (19): CapturedLoginMaterial, finalizeCapturedLogin(), finalizeStoredBrowserCapture(), PairedCredentialRejectedError, persistCapturedRefreshCookie(), sessionFromAccessTokenCapture(), sessionFromExchange(), sessionFromLiveCredential() (+11 more)

### Community 62 - "pair-login.ts"
Cohesion: 0.08
Nodes (36): base64UrlDecode(), base64UrlEncode(), capturedMaterialFromPairPayload(), decryptFromBrowser(), DEFAULT_RELAY_URL, deriveMailboxId(), deriveSharedAesKey(), encryptForCli() (+28 more)

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

### Community 70 - "4. 分阶段实施"
Cohesion: 0.12
Nodes (16): 1. 定位与原则, 2. 分支与 PR 策略, 3. 目标架构, 4. 分阶段实施, 5. 待决技术决策, 6. 风险与缓解, OnTrack TUI 全面实施计划, Phase 0 — 分支整理与骨架 PR (+8 more)

### Community 71 - "planner.ts"
Cohesion: 0.15
Nodes (20): buildPlannerViews(), dateFrom(), defaultDate(), gradeDateRow(), integerValue(), parseDateOnly(), personalDate(), PlanDateChange (+12 more)

### Community 72 - "Authentication and session management"
Cohesion: 0.12
Nodes (16): Authentication and session management, Browser capture: `--auto`, `--show-browser`, `--hide-browser`, Browser refresh state location, Direct token login, How long a paired session lasts, and why it cannot last longer, Login flow output, Logout, Manual redirect import (backup only) (+8 more)

### Community 73 - "Command reference"
Cohesion: 0.15
Nodes (13): Account and connectivity, Command reference, Default output, Diagnostics and discovery, Download directory, Feedback and live tracking, Force colors on or off, Interactive terminal interfaces (+5 more)

### Community 74 - "agent-execution-engine.ts"
Cohesion: 0.10
Nodes (24): AgentBasePolicy, AgentCallRequest, AgentCommandDefinition, AgentCommandManifest, AgentCommandPolicy, AgentExecutionEngineOptions, AgentExecutionEnvelope, AgentNonWritePolicy (+16 more)

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
Cohesion: 0.10
Nodes (36): bun, assertChildPath(), assertRegularTree(), createTuiCapture(), exitsWithin(), inspectTarball(), InstalledPackagePaths, installPackedPackage() (+28 more)

### Community 80 - "3. 真实环境新增或显著强化的产品面"
Cohesion: 0.22
Nodes (9): 3.1 品牌与全局导航, 3.2 Project Dashboard, 3.3 Task Details, 3.4 Task Planner, 3.5 Submission 工作流, 3.6 Portfolio, 3.7 Tutorials 与 Groups, 3.8 Profile、Calendar 与 QR (+1 more)

### Community 81 - "Pairing Relay 云端免凭证登录（E2E 加密配对 + bookmarklet 抓取）"
Cohesion: 0.22
Nodes (8): A. 本仓库（ontrack-cli）, B. 新仓库 `ontrack-pair-relay`（独立仓库，本地脚手架建在 `/Users/mark/ontrack-pair-relay`，即本仓库的**同级目录**——在工作目录之外，执行时需用户确认）, Pairing Relay 云端免凭证登录（E2E 加密配对 + bookmarklet 抓取）, 协议设计（单方案）, 改动清单, 明确不做（本次范围外）, 目标, 验证

### Community 83 - "handleTaskStatus"
Cohesion: 0.24
Nodes (15): claimConfirmedWrite(), handlePlanCommand(), handlePlanReset(), handlePlanSetDates(), handleTaskStatus(), loadPlannerContext(), plannerReadback(), recordUnknownWrite() (+7 more)

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
Cohesion: 0.33
Nodes (5): handleNativeAgentCommand(), writeNativeAgentStream(), AgentExecutionEngine, defineAgentStreamCommand(), exitCodeForAgentEnvelope()

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

### Community 94 - "project-catalogue.ts"
Cohesion: 0.33
Nodes (7): AGENT_REMOTE_READ_CONCURRENCY, mapWithConcurrency(), settleWithConcurrency(), settleMetadataReads(), StudentTaskView, TaskDefinitionSummary, TaskSummary

### Community 95 - "OnTrackAuthBroker"
Cohesion: 0.29
Nodes (3): OnTrackAuthBroker, AuthEnsureOptions, AuthRuntimeResult

### Community 96 - "repository"
Cohesion: 0.67
Nodes (3): repository, type, url

### Community 97 - "overrides"
Cohesion: 0.50
Nodes (4): overrides, adm-zip, js-yaml, sharp

### Community 98 - "auto-login-browser-adapter.test.ts"
Cohesion: 0.17
Nodes (8): BrowserLaunchAdapter, captureSsoCredentialsWithGuidedLogin(), isSameSsoUser(), setSsoBrowserProfileDirForTests(), FakeBrowserOptions, Handler, PersistentLaunch, withSsoProfileDir()

### Community 100 - "task-extras.ts"
Cohesion: 0.17
Nodes (20): SubmissionPdfState, redactSensitiveText(), SubmitOutcome, humanizeBytes(), slotsFor(), SPINNER, Stage, SubmitWizard() (+12 more)

### Community 104 - "tui/auth.ts"
Cohesion: 0.10
Nodes (26): AuthDiagnostic, AuthDiagnosticSink, persistRefreshCookieBestEffort(), REFRESH_COOKIE_PERSISTENCE_DIAGNOSTIC, MfaMethodOption, SsoFallbackReason, SsoStep, availableLoginMethods() (+18 more)

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
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `client` connect `auth-mcp-server.ts` to `verify-package.ts`?**
  _High betweenness centrality (0.081) - this node is a cross-community bridge._
- **Why does `verifyInstalledAuthMcp()` connect `verify-package.ts` to `auth-mcp-server.ts`?**
  _High betweenness centrality (0.071) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _603 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `remoteContractFailure` be split into smaller, more focused modules?**
  _Cohesion score 0.14710884353741496 - nodes in this community are weakly interconnected._
- **Should `api.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0540045766590389 - nodes in this community are weakly interconnected._
- **Should `utils.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08325624421831637 - nodes in this community are weakly interconnected._
- **Should `promptTaskSelectorFromTaskList` be split into smaller, more focused modules?**
  _Cohesion score 0.13846153846153847 - nodes in this community are weakly interconnected._