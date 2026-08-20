# Graph Report - ontrack-cli  (2026-08-20)

## Corpus Check
- 143 files · ~206,075 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2046 nodes · 5205 edges · 100 communities (97 shown, 3 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 49 edges (avg confidence: 0.57)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ac63a9e9`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- remoteContractFailure
- api.ts
- utils.ts
- handleTaskStatus
- lightpanda-provider.ts
- agent-commands.ts
- auto-login.ts
- contracts.ts
- printJson
- command-spec.ts
- submission-lifecycle.ts
- AgentProtocolError
- agent-tasks.ts
- auth-broker.ts
- scripts
- discovery.ts
- agent-watch.ts
- verify-package.ts
- OnTrack 真实环境变化审计（2026-07-31）
- auth-runtime.ts
- artifact-safety.ts
- OnTrack CLI CI/CD 设计
- student-task-view.ts
- command-input.ts
- auth-mcp-server.ts
- agent-protocol.ts
- captureSsoCredentialsInternal
- auto-login.test.ts
- check-coverage.ts
- agent-feedback.ts
- package.json
- compilerOptions
- OnTrack CLI Agent-Ready 实施计划
- data.ts
- launchBrowserForCapture
- session.ts
- captureCredentialsFromPersistedStateFile
- persistRefreshCookie
- app.tsx
- check-skill-lock.ts
- smoke-tui.tsx
- createAuthenticatedApi
- smoke-real.mjs
- devDependencies
- dependencies
- auto-login-session-reuse.test.ts
- keywords
- runWelcomeAction
- check-gitnexus-skill-sync.ts
- agent-task-reads.ts
- OnTrack CLI 架构重构计划与实施记录（2026-07-31）
- check-skill-lock.test.ts
- task-extras.ts
- watch-snapshots.ts
- cli.ts
- agent-units.ts
- workflow-security.test.ts
- Always Ontrack (ontrack-cli)
- login-finalize.ts
- pair-login.ts
- 4. Module 1：Auth lifecycle / security identity
- 5. Module 2：StudentTaskView / task aggregation
- 6. Module 3：Submission lifecycle
- 7. Module 4：Task Planner / date semantics
- 8. Module 5：Production contract discovery + fixture
- compilerOptions
- submission-upload.ts
- 4. 分阶段实施
- types.ts
- Authentication and session management
- Command reference
- agent-execution-engine.ts
- OnTrack CLI domain context
- Always Ontrack (ontrack-cli)
- Local development
- Agent usage
- execution-journal.ts
- 3. 真实环境新增或显著强化的产品面
- Pairing Relay 云端免凭证登录（E2E 加密配对 + bookmarklet 抓取）
- Core concepts
- Troubleshooting
- Typical workflows
- contracts.test.ts
- 8. 建议的大改方向
- OnTrackAuthBroker
- 4. 真实 API 合同快照
- 7. 前端 route 盘点
- normalizeReadOnlyRoute
- repository
- overrides
- agent-plan.ts
- task-set-status-cli.test.ts
- handleFeedbackWatch

## God Nodes (most connected - your core abstractions)
1. `SessionData` - 65 edges
2. `OnTrackApiClient` - 52 edges
3. `remoteContractFailure()` - 48 edges
4. `createAuthenticatedApi()` - 48 edges
5. `loadProjectsWithTaskMetadata()` - 40 edges
6. `printJson()` - 34 edges
7. `main()` - 33 edges
8. `AgentProtocolError` - 33 edges
9. `hasFlag()` - 33 edges
10. `requireSession()` - 31 edges

## Surprising Connections (you probably didn't know these)
- `readPersistedSession()` --indirect_call--> `configRoot()`  [INFERRED]
  test/login-finalize.test.ts → src/lib/execution-journal.ts
- `submissionTask()` --calls--> `buildStudentTaskViews()`  [EXTRACTED]
  test/submission-lifecycle.test.ts → src/lib/student-task-view.ts
- `withClient()` --calls--> `createAuthMcpServer()`  [EXTRACTED]
  test/auth-mcp.test.ts → src/auth-mcp-server.ts
- `run()` --references--> `bun`  [EXTRACTED]
  scripts/verify-package.ts → package.json
- `withClient()` --references--> `client`  [EXTRACTED]
  test/auth-mcp.test.ts → scripts/check-gitnexus-mcp.ts

## Import Cycles
- None detected.

## Communities (100 total, 3 thin omitted)

### Community 0 - "remoteContractFailure"
Cohesion: 0.18
Nodes (37): RFC-3339, AGENT_MULTILINE_SAFE_TEXT_PATTERN, AGENT_SAFE_TEXT_PATTERN, contractAliasedArray(), contractAliasedValue(), contractPositiveInteger(), contractProjectUnit, contractRecord() (+29 more)

### Community 1 - "api.ts"
Cohesion: 0.06
Nodes (55): handleDoctor(), readAgentFeedbackList(), readAgentFeedbackTarget(), readAgentFeedbackWatch(), readAgentTutorialsStatus(), readWatchComments(), authHeaders(), AuthSessionRefresh (+47 more)

### Community 2 - "utils.ts"
Cohesion: 0.05
Nodes (67): handleLogin(), readAuthStatus(), downloadTaskResourceArtifacts(), taskResourceIdentity(), ssoRedirectUrl(), captureSsoCredentials(), classifySsoFallback(), readStoredRefreshCookie() (+59 more)

### Community 3 - "handleTaskStatus"
Cohesion: 0.26
Nodes (16): claimConfirmedWrite(), handlePlanCommand(), handlePlanReset(), handlePlanSetDates(), handleSubmissionCommand(), handleSubmissionUpload(), handleTaskStatus(), loadPlannerContext() (+8 more)

### Community 4 - "lightpanda-provider.ts"
Cohesion: 0.07
Nodes (35): main(), readPublicOktaUrl(), requiredLightpandaPath(), cleanupFailure(), defaultFileSystem, defaultRuntime, executableValidationError(), hasExited() (+27 more)

### Community 5 - "agent-commands.ts"
Cohesion: 0.04
Nodes (52): AgentAuthStatus, agentFeedbackItemSchema, agentFeedbackListInputSchema, agentFeedbackMultilineTextSchema, agentFeedbackTextSchema, agentFeedbackWatchInputSchema, agentFeedbackWatchItemSchema, agentFeedbackWatchOptions (+44 more)

### Community 6 - "auto-login.ts"
Cohesion: 0.07
Nodes (40): BrowserLaunchPlan, BrowserStorageEntry, BrowserStorageState, ClaimedBrowserSessionState, clickDetectedMfaOption(), collectKnownMfaMethodOptions(), collectMfaSelectionOptions(), collectSelectControls() (+32 more)

### Community 7 - "contracts.ts"
Cohesion: 0.14
Nodes (25): collectUnexpectedKeys(), collectUnsafePayload(), collectUnsafeShapeEnums(), ContractDrift, ContractFixture, ContractFixtureMetadata, ContractProvenance, ContractRisk (+17 more)

### Community 8 - "printJson"
Cohesion: 0.17
Nodes (47): buildInboxFallbackTasksFromProjectDetails(), countTasksByStatus(), describeWatchEvent(), flattenTasks(), handleAuthEnsure(), handleAuthMethod(), handleAuthStatus(), handleDiscover() (+39 more)

### Community 9 - "command-spec.ts"
Cohesion: 0.07
Nodes (37): AGENT_TASKS_LIST_MAX_STATUS_LENGTH, agentFeedbackListOutputSchema, agentFeedbackWatchFrameSchema, agentPlanShowInputSchema, agentPlanShowOutputSchema, agentProjectsListInputSchema, agentProjectsListOutputSchema, agentTasksListInputSchema (+29 more)

### Community 10 - "submission-lifecycle.ts"
Cohesion: 0.11
Nodes (31): buildAgentSubmissionStatusOutput(), PlannerView, StudentTaskReference, booleanValue(), createSubmissionAttempt(), hasOwnField(), InvalidSubmissionDetailsError, isSubmissionObserved() (+23 more)

### Community 11 - "AgentProtocolError"
Cohesion: 0.26
Nodes (9): nonNegativeInteger(), AgentProjectCapabilities, AgentProjectDirectoryItem, booleanValue(), buildAgentProjectsListOutput(), completeAgentEnvelopeBytes(), projectCapabilities(), projectDirectoryItem() (+1 more)

### Community 12 - "agent-tasks.ts"
Cohesion: 0.14
Nodes (20): AgentTasksListOutput, AgentFeedbackListSource, createAgentFeedbackTarget(), AgentProjectUnitSource, canonicalTutorialStatusUnit(), AgentTaskCatalogueItem, AgentTasksListContext, AgentTasksListSource (+12 more)

### Community 13 - "auth-broker.ts"
Cohesion: 0.21
Nodes (10): AuthStatusView, createOnTrackAuthBroker(), defaultDependencies(), OnTrackAuthBrokerDependencies, OnTrackAuthBrokerOptions, sessionFromCapture(), createSessionFromAccessToken(), AutoLoginOptions (+2 more)

### Community 14 - "scripts"
Cohesion: 0.07
Nodes (28): scripts, build, clean, dev, gitnexus:analyze, gitnexus:check, gitnexus:context, gitnexus:detect-changes (+20 more)

### Community 15 - "discovery.ts"
Cohesion: 0.10
Nodes (33): ProbeResult, API_HINTS, classifyDiscoveredPaths(), contextKeyForParameter(), DEFAULT_DISCOVERY_PROBE_REQUEST_BUDGET, discoverOnTrackSurface(), DiscoveryAsset, DiscoveryResult (+25 more)

### Community 16 - "agent-watch.ts"
Cohesion: 0.10
Nodes (30): agentPlanDateSchema(), AGENT_RFC3339_TIMESTAMP_PATTERN, contractNonNegativeInteger(), contractRfc3339Timestamp(), isAgentRfc3339Timestamp(), AgentWatchDate, AgentWatchDateKind, agentWatchDateSchema (+22 more)

### Community 17 - "verify-package.ts"
Cohesion: 0.12
Nodes (20): engines, bun, client, expectedTools, transport, assertChildPath(), assertRegularTree(), isAllowedEntry() (+12 more)

### Community 18 - "OnTrack 真实环境变化审计（2026-07-31）"
Cohesion: 0.11
Nodes (17): 10. 仍需进一步验证的未知项, 11. 与本地代码的直接对应, 12. 本轮实施状态与架构决策入口, 13. 最终实施结果, 1. 审计范围, 2.1 保留的核心合同, 2.2 已经失效或明显不足的核心假设, 2. 总体判断 (+9 more)

### Community 19 - "auth-runtime.ts"
Cohesion: 0.14
Nodes (14): AuthInteractionMode, authRequired(), AuthRuntime, AuthRuntimeAdapter, createAuthRuntime(), credentialVersionChanged(), inFlightKey(), isFreshEnough() (+6 more)

### Community 20 - "artifact-safety.ts"
Cohesion: 0.22
Nodes (22): ArtifactOutputOptions, ArtifactPathOptions, ArtifactSafetyError, assertCleanPathInput(), assertNoSymbolicLinkComponents(), assertSafeFilename(), findExternalArtifactPaths(), inspectUploadFile() (+14 more)

### Community 21 - "OnTrack CLI CI/CD 设计"
Cohesion: 0.06
Nodes (33): 10. 已决策与管理面 Gates, 11. 官方来源, 1. 结论与范围, 2. 已核对的事实与约束, 3. 目标流水线, 4.1 `.github/workflows/ci.yml`, 4.2 `.github/workflows/dependency-review.yml`, 4.3 `.github/workflows/release.yml` (+25 more)

### Community 22 - "student-task-view.ts"
Cohesion: 0.14
Nodes (26): BuildStudentTaskViewOptions, buildStudentTaskViews(), definitionsForProject(), definitionTargetGrade(), definitionTutorialStream(), embeddedDefinition(), enrolledTutorialStreams(), includeVisibility() (+18 more)

### Community 23 - "command-input.ts"
Cohesion: 0.14
Nodes (18): AGENT_GLOBAL_FLAGS, encodeField(), flagOccurrences(), GROUPED_AGENT_COMMANDS, mergeStructuredCommandInput(), parseObject(), readFlagValue(), removeFlagPair() (+10 more)

### Community 24 - "auth-mcp-server.ts"
Cohesion: 0.17
Nodes (13): AuthMcpDependencies, configuredBaseUrl(), createAuthMcpServer(), defaultDependencies(), nextActionSchema, serveAuthMcp(), toolResponse(), ToolResult (+5 more)

### Community 25 - "agent-protocol.ts"
Cohesion: 0.14
Nodes (24): AGENT_SCHEMA_VERSION, AgentArtifact, AgentErrorCode, agentErrorEnvelope(), AgentNextAction, AgentOutputContext, AgentProtocolErrorOptions, AgentStatus (+16 more)

### Community 26 - "captureSsoCredentialsInternal"
Cohesion: 0.14
Nodes (24): advanceGuidedSsoOnPage(), BLOCKED_LINK_HOSTS, canUseSelector(), canUseSelectorInScopes(), captureSsoCredentialsInternal(), clickFirstVisible(), clickLikelyActionControl(), collectCredentialScopes() (+16 more)

### Community 27 - "auto-login.test.ts"
Cohesion: 0.17
Nodes (16): clearBrowserSessionState(), expandSystemBrowserProfileCandidates(), extractCredentialsFromAuthPayload(), extractCredentialsFromStorageEntries(), extractCredentialsFromUnknownObject(), extractCredentialsFromUrl(), extractRefreshCookieMaterial(), extractUsernameFromUserRecord() (+8 more)

### Community 28 - "check-coverage.ts"
Cohesion: 0.22
Nodes (15): assertThreshold(), checkCoverage(), CoverageEvaluation, CoverageMetric, CoverageSummary, CoverageThresholds, evaluateCoverage(), formatMetric() (+7 more)

### Community 29 - "agent-feedback.ts"
Cohesion: 0.11
Nodes (27): AgentFeedbackListInput, AgentFeedbackListOutput, AgentFeedbackWatchInput, AgentFeedbackItem, AgentFeedbackReadContext, AgentFeedbackTarget, AgentFeedbackTask, AgentFeedbackWatchContext (+19 more)

### Community 30 - "package.json"
Cohesion: 0.11
Nodes (18): bin, ontrack, ontrack-auth-mcp, bugs, url, description, files, homepage (+10 more)

### Community 31 - "compilerOptions"
Cohesion: 0.11
Nodes (18): node_modules, src/**/*.ts, src/tui, compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution (+10 more)

### Community 32 - "OnTrack CLI Agent-Ready 实施计划"
Cohesion: 0.07
Nodes (26): 10. 测试矩阵, 11. 发布判断, 1. 产品定位, 2. 核心架构, 3. 不变量, 4.1 成功响应, 4.2 错误与暂停响应, 4. Agent 协议 (+18 more)

### Community 33 - "data.ts"
Cohesion: 0.15
Nodes (17): nonBlankStringValue(), numberValue(), stringValue(), toWhoAmIView(), WhoAmIView, bucketStatus(), daysUntil(), formatDue() (+9 more)

### Community 34 - "launchBrowserForCapture"
Cohesion: 0.12
Nodes (12): asErrorMessage(), browserInstallHint(), BrowserLaunchAdapter, candidateBrowserPaths(), captureSsoCredentialsWithGuidedLogin(), isMissingDisplayServerError(), isMissingSharedLibraryError(), launchBrowserForCapture() (+4 more)

### Community 35 - "session.ts"
Cohesion: 0.13
Nodes (22): migrateLegacySession(), clearAllBrowserSessionState(), AcquiredSessionRefreshLock, acquireSessionRefreshLock(), clearSession(), getConfigRoot(), getSessionPath(), isNodeError() (+14 more)

### Community 36 - "captureCredentialsFromPersistedStateFile"
Cohesion: 0.16
Nodes (13): captureCredentialsFromPersistedStateFile(), captureCredentialsFromStoredBrowserSession(), captureCredentialsFromSystemBrowserProfile(), closeBrowserAtMost(), extractCredentialsFromCookieJar(), extractCredentialsFromLocalStorage(), extractCredentialsFromRequestHeaders(), isSystemBrowserProfileReuseEnabled() (+5 more)

### Community 37 - "persistRefreshCookie"
Cohesion: 0.33
Nodes (16): assertTrustedBrowserSessionStateDirectory(), buildContextOptionsWithStoredSession(), claimBrowserSessionState(), filterBrowserSessionState(), hasReusableBrowserSessionState(), isBrowserStorageState(), persistRefreshCookie(), publishCapturedBrowserSessionState() (+8 more)

### Community 38 - "app.tsx"
Cohesion: 0.08
Nodes (35): isFilesRequiredRejection(), App(), Command, dueBadge(), fuzzyMatch(), Header(), matches(), Mode (+27 more)

### Community 39 - "check-skill-lock.ts"
Cohesion: 0.31
Nodes (9): collectFiles(), computeSkillFolderHash(), HashedFile, isRecord(), listInstalledSkillNames(), main(), parseLock(), SkillLock (+1 more)

### Community 40 - "smoke-tui.tsx"
Cohesion: 0.08
Nodes (16): attemptKeys, expiredSubmit, flakyLoad(), hangingExtras, okSubmit, openWizard(), pasteSubmitActions, readyLoad() (+8 more)

### Community 41 - "createAuthenticatedApi"
Cohesion: 0.16
Nodes (28): agentSubmissionStatusInputFromSelector(), buildWatchSnapshot(), createNativeAgentExecutionEngine(), handleSubmissionStatus(), readAgentPlanShow(), readAgentProjectsList(), readAgentTaskShow(), readAgentTasksList() (+20 more)

### Community 42 - "smoke-real.mjs"
Cohesion: 0.50
Nodes (7): main(), parseArgs(), pickFirstTask(), run(), runFeedbackWatch(), runJson(), runWatch()

### Community 43 - "devDependencies"
Cohesion: 0.29
Nodes (7): devDependencies, @types/node, @types/react, typescript, @types/node, @types/react, typescript

### Community 44 - "dependencies"
Cohesion: 0.15
Nodes (13): @modelcontextprotocol/sdk, @opentui/core, @opentui/react, dependencies, @modelcontextprotocol/sdk, @opentui/core, @opentui/react, playwright-core (+5 more)

### Community 45 - "auto-login-session-reuse.test.ts"
Cohesion: 0.20
Nodes (7): injectRememberIntoAuthExchange(), isBrowserStorageCookie(), isBrowserStorageOrigin(), isRecord(), setBrowserSessionStatePathForTests(), browserStateEnvironmentTail, withBrowserState()

### Community 46 - "keywords"
Cohesion: 0.33
Nodes (6): keywords, agent, cli, doubtfire, mcp, ontrack

### Community 47 - "runWelcomeAction"
Cohesion: 0.14
Nodes (27): buildTaskSelectorArgs(), expandHomePath(), handleWelcome(), help(), optionalFlagArgs(), panelBodyCode(), panelToneCode(), panelVisibleLength() (+19 more)

### Community 50 - "agent-task-reads.ts"
Cohesion: 0.09
Nodes (27): AgentSubmissionPdfInput, AgentSubmissionPdfOutput, AgentSubmissionStatusInput, AgentSubmissionStatusOutput, agentSubmissionStatusOutputSchema, AgentTaskPdfInput, AgentTaskPdfOutput, AgentTaskPrerequisitesInput (+19 more)

### Community 51 - "OnTrack CLI 架构重构计划与实施记录（2026-07-31）"
Cohesion: 0.12
Nodes (17): 10. 完成定义, 11. 2026-07-31 实施完成记录, 1.1 重构目标, 1.2 强制术语, 1.3 不变量, 1. 目标、术语与约束, 2.1 真实环境证据, 2.2 当前源码中的耦合 (+9 more)

### Community 53 - "task-extras.ts"
Cohesion: 0.12
Nodes (17): SubmissionPdfState, SubmitOutcome, humanizeBytes(), slotsFor(), SPINNER, Stage, SubmitWizard(), TRIGGER_CHOICES (+9 more)

### Community 54 - "watch-snapshots.ts"
Cohesion: 0.16
Nodes (19): AgentPlanShowOutput, AgentWatchState, AGENT_REMOTE_READ_CONCURRENCY, mapWithConcurrency(), settleWithConcurrency(), settleMetadataReads(), getLatestFeedbackTimestamp(), makeWatchTaskKey() (+11 more)

### Community 55 - "cli.ts"
Cohesion: 0.07
Nodes (44): applyLimit(), arrayLength(), dedupeInboxTasks(), deriveUnitsFromProjects(), DIGITAL_LOGO_LINES, DoctorCheck, extractInboxProjectId(), feedbackAuthor() (+36 more)

### Community 56 - "agent-units.ts"
Cohesion: 0.28
Nodes (9): AgentUnitShowSource, assertUnitMetadataMatchesProject(), authoritativeProject(), booleanValue(), completeAgentEnvelopeBytes(), createAgentUnitShow(), invalidArgument(), projectCapabilities() (+1 more)

### Community 60 - "Always Ontrack (ontrack-cli)"
Cohesion: 0.12
Nodes (17): Agent-first 使用方式, Always Ontrack (ontrack-cli), 功能概览, 原生 caller-first 接口, 原生命令目录, 发现协议, 命令参考, 安装 (+9 more)

### Community 61 - "login-finalize.ts"
Cohesion: 0.15
Nodes (16): classifyAuthFailure(), CapturedLoginMaterial, finalizeCapturedLogin(), PairedCredentialRejectedError, sessionFromAccessTokenCapture(), sessionFromExchange(), sessionFromLiveCredential(), sessionFromPairedCredential() (+8 more)

### Community 62 - "pair-login.ts"
Cohesion: 0.08
Nodes (33): base64UrlDecode(), base64UrlEncode(), capturedMaterialFromPairPayload(), decryptFromBrowser(), DEFAULT_RELAY_URL, deriveMailboxId(), deriveSharedAesKey(), encryptForCli() (+25 more)

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

### Community 69 - "submission-upload.ts"
Cohesion: 0.19
Nodes (17): AuthFailureKind, OnTrackHttpError, SubmissionAttemptState, applySubmissionUpload(), ApplySubmissionUploadInput, claimSubmissionWrite(), deriveDefaultSubmissionTrigger(), parseSubmissionTrigger() (+9 more)

### Community 70 - "4. 分阶段实施"
Cohesion: 0.12
Nodes (16): 1. 定位与原则, 2. 分支与 PR 策略, 3. 目标架构, 4. 分阶段实施, 5. 待决技术决策, 6. 风险与缓解, OnTrack TUI 全面实施计划, Phase 0 — 分支整理与骨架 PR (+8 more)

### Community 71 - "types.ts"
Cohesion: 0.18
Nodes (12): DEFAULT_AUTH_MIN_TTL_SECONDS, ApplyStatusTriggerInput, ApplyStatusTriggerOutcome, AccessTokenResponse, OnTrackUser, StudentStatusTrigger, TaskBatchSelector, TaskUploadRequirement (+4 more)

### Community 72 - "Authentication and session management"
Cohesion: 0.15
Nodes (13): Authentication and session management, Browser capture: `--auto`, `--show-browser`, `--hide-browser`, Browser refresh state location, Direct token login, Login flow output, Logout, Manual redirect import (backup only), Pairing sign-in (default on every environment) (+5 more)

### Community 73 - "Command reference"
Cohesion: 0.15
Nodes (13): Account and connectivity, Command reference, Default output, Diagnostics and discovery, Download directory, Feedback and live tracking, Force colors on or off, Interactive launcher (+5 more)

### Community 74 - "agent-execution-engine.ts"
Cohesion: 0.05
Nodes (39): handleNativeAgentCommand(), normalizeAgentCliError(), writeNativeAgentStream(), AgentCallInputDependencies, AgentCallInvocation, invalidArgument(), parseAgentCallInvocation(), parseInputObject() (+31 more)

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

### Community 79 - "execution-journal.ts"
Cohesion: 0.25
Nodes (17): atomicWrite(), claimExecution(), configRoot(), digest(), ExecutionClaim, executionFingerprint(), ExecutionJournalOptions, ExecutionRecord (+9 more)

### Community 80 - "3. 真实环境新增或显著强化的产品面"
Cohesion: 0.22
Nodes (9): 3.1 品牌与全局导航, 3.2 Project Dashboard, 3.3 Task Details, 3.4 Task Planner, 3.5 Submission 工作流, 3.6 Portfolio, 3.7 Tutorials 与 Groups, 3.8 Profile、Calendar 与 QR (+1 more)

### Community 81 - "Pairing Relay 云端免凭证登录（E2E 加密配对 + bookmarklet 抓取）"
Cohesion: 0.22
Nodes (8): A. 本仓库（ontrack-cli）, B. 新仓库 `ontrack-pair-relay`（独立仓库，本地脚手架建在 `/Users/mark/ontrack-pair-relay`，即本仓库的**同级目录**——在工作目录之外，执行时需用户确认）, Pairing Relay 云端免凭证登录（E2E 加密配对 + bookmarklet 抓取）, 协议设计（单方案）, 改动清单, 明确不做（本次范围外）, 目标, 验证

### Community 83 - "Core concepts"
Cohesion: 0.25
Nodes (8): `abbr`, Batch task selectors, Core concepts, `--json`, `project`, `task`, `taskDefinitionId`, `unit`

### Community 84 - "Troubleshooting"
Cohesion: 0.25
Nodes (8): `419 Authentication Timeout`, `Error: 403 Forbidden: Unable to list units`, `Inbox endpoint unavailable ... Showing fallback task list`, `No browser executable found ...`, No color highlighting, `Task abbreviation "... " is ambiguous`, Troubleshooting, Upload key mismatch or incorrect file count

### Community 85 - "Typical workflows"
Cohesion: 0.25
Nodes (8): Difference between `submission upload` and `submission upload-new-files`, Typical workflows, Upload matching rules, Workflow 1: sign in and find your tasks, Workflow 2: inspect one task end to end, Workflow 3: watch live conversation and status changes, Workflow 4: download PDFs, Workflow 5: upload a submission

### Community 86 - "contracts.test.ts"
Cohesion: 0.20
Nodes (10): collectShapeDrift(), diffContractShapes(), enumText(), loadContractFixture(), normalizeProductionPayload(), normalizeValue(), SAFE_ENUM_FIELDS, sanitizeProductionPayload() (+2 more)

### Community 87 - "8. 建议的大改方向"
Cohesion: 0.33
Nodes (6): 8. 建议的大改方向, Phase 0：安全与认证（先做）, Phase 1：重建领域聚合层, Phase 2：重新设计 CLI 命令面, Phase 3：提交与反馈生命周期, Phase 4：角色与高级模块

### Community 88 - "OnTrackAuthBroker"
Cohesion: 0.33
Nodes (3): OnTrackAuthBroker, AuthEnsureOptions, AuthRuntimeResult

### Community 89 - "4. 真实 API 合同快照"
Cohesion: 0.40
Nodes (5): 4.1 认证, 4.2 Project summary 与 project detail, 4.3 Unit detail 成为任务目录的主要来源, 4.4 新增/关键 endpoint, 4. 真实 API 合同快照

### Community 90 - "7. 前端 route 盘点"
Cohesion: 0.50
Nodes (4): 7. 前端 route 盘点, Staff/管理端（仅 bundle 发现，未验证权限）, Student 主流程, Task/教学扩展

### Community 91 - "normalizeReadOnlyRoute"
Cohesion: 0.50
Nodes (4): canonicalRoute(), normalizeReadOnlyRoute(), READ_ONLY_METHODS, ROUTE_CATALOG

### Community 96 - "repository"
Cohesion: 0.67
Nodes (3): repository, type, url

### Community 97 - "overrides"
Cohesion: 0.50
Nodes (4): overrides, adm-zip, js-yaml, sharp

### Community 106 - "agent-plan.ts"
Cohesion: 0.12
Nodes (37): AgentPlanShowInput, aliasValues(), buildAgentPlanShowOutput(), calendarDate(), normalizePrerequisites(), own(), pairedArray(), pairedBoolean() (+29 more)

### Community 107 - "task-set-status-cli.test.ts"
Cohesion: 0.31
Nodes (6): baseArgs, projectPayload(), sendJson(), statusHandler(), StatusPutBehavior, unitPayload()

### Community 110 - "handleFeedbackWatch"
Cohesion: 0.22
Nodes (9): agentFeedbackListInputFromSelector(), handleFeedbackCommand(), handleFeedbackList(), handleFeedbackWatch(), parseAgentFeedbackListSelector(), printWatchJson(), rethrowWatchAuthFailure(), PollingStreamOptions (+1 more)

## Knowledge Gaps
- **587 isolated node(s):** `name`, `version`, `description`, `license`, `type` (+582 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `withClient()` connect `verify-package.ts` to `auth-mcp-server.ts`?**
  _High betweenness centrality (0.092) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _587 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `api.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.057002457002457 - nodes in this community are weakly interconnected._
- **Should `utils.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05441400304414003 - nodes in this community are weakly interconnected._
- **Should `lightpanda-provider.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06988120195667366 - nodes in this community are weakly interconnected._
- **Should `agent-commands.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.037037037037037035 - nodes in this community are weakly interconnected._
- **Should `auto-login.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06951219512195123 - nodes in this community are weakly interconnected._