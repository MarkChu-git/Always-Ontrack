# Graph Report - tutorial-status  (2026-08-07)

## Corpus Check
- 106 files · ~133,820 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1754 nodes · 4269 edges · 108 communities (103 shown, 5 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 36 edges (avg confidence: 0.58)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `38d2b8c3`
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
- main
- command-spec.ts
- submission-lifecycle.ts
- handleSubmissionUpload
- student-task-view.ts
- auth-broker.ts
- scripts
- discovery.ts
- agent-watch.ts
- verify-package.ts
- OnTrack 真实环境变化审计（2026-07-31）
- auth-runtime.ts
- artifact-safety.ts
- OnTrack CLI CI/CD 设计
- createAgentTutorialsStatus
- command-input.ts
- auth-mcp-server.ts
- agent-protocol.ts
- advanceGuidedSsoOnPage
- auto-login.test.ts
- check-coverage.ts
- agent-feedback.ts
- package.json
- compilerOptions
- OnTrack CLI Agent-Ready 实施计划
- agent-units.ts
- auto-login-browser-adapter.test.ts
- session.ts
- captureSsoCredentialsInternal
- isBrowserStorageState
- agent-projects.ts
- check-skill-lock.ts
- createNativeAgentCommands
- extractCredentialsFromStorageEntries
- smoke-real.mjs
- devDependencies
- dependencies
- auto-login-session-reuse.test.ts
- keywords
- watch-snapshots.ts
- check-gitnexus-skill-sync.ts
- Quick start
- OnTrack CLI 架构重构计划与实施记录（2026-07-31）
- check-skill-lock.test.ts
- handleLogin
- agent-contract.ts
- repository
- workflow-security.test.ts
- Always Ontrack (ontrack-cli)
- 快速开始
- createAuthenticatedApi
- 4. Module 1：Auth lifecycle / security identity
- 5. Module 2：StudentTaskView / task aggregation
- 6. Module 3：Submission lifecycle
- 7. Module 4：Task Planner / date semantics
- 8. Module 5：Production contract discovery + fixture
- Troubleshooting
- Core concepts
- Typical workflows
- 故障排查
- 核心概念
- 常见工作流
- agent-execution-engine.ts
- OnTrack CLI domain context
- Always Ontrack (ontrack-cli)
- Authentication and session management
- 登录与会话
- execution-journal.ts
- Command reference
- Files and directories
- Agent-first usage
- Local development
- Output, highlighting, and JSON
- 文件与目录
- Agent-first 使用方式
- 输出、高亮与 JSON
- 命令总览
- 本地开发
- whoami.ts
- Installation
- 安装
- 1. 目标、术语与约束
- 9. 跨 Module 测试、真实环境验证与回滚
- planner.ts
- types.ts
- agent-call-input.ts
- AgentExecutionEngine
- pollUntilInterrupted
- contracts.test.ts
- OnTrackAuthBroker
- overrides
- normalizeReadOnlyRoute
- bin
- agent-plan.ts
- extractMfaNumberChallengeFromText

## God Nodes (most connected - your core abstractions)
1. `SessionData` - 54 edges
2. `remoteContractFailure()` - 46 edges
3. `OnTrackApiClient` - 38 edges
4. `createAuthenticatedApi()` - 36 edges
5. `handleSubmissionUpload()` - 34 edges
6. `main()` - 33 edges
7. `printJson()` - 33 edges
8. `loadProjectsWithTaskMetadata()` - 32 edges
9. `hasFlag()` - 32 edges
10. `requireSession()` - 30 edges

## Surprising Connections (you probably didn't know these)
- `submissionTask()` --calls--> `buildStudentTaskViews()`  [EXTRACTED]
  test/submission-lifecycle.test.ts → src/lib/student-task-view.ts
- `withClient()` --references--> `client`  [EXTRACTED]
  test/auth-mcp.test.ts → scripts/check-gitnexus-mcp.ts
- `run()` --references--> `bun`  [EXTRACTED]
  scripts/verify-package.ts → package.json
- `main()` --calls--> `launchLightpandaPublicSpike()`  [EXTRACTED]
  scripts/lightpanda-public-spike.ts → src/lib/lightpanda-provider.ts
- `withClient()` --calls--> `createAuthMcpServer()`  [EXTRACTED]
  test/auth-mcp.test.ts → src/auth-mcp-server.ts

## Import Cycles
- None detected.

## Communities (108 total, 5 thin omitted)

### Community 0 - "agent-tasks.ts"
Cohesion: 0.18
Nodes (40): contractAliasedArray(), contractAliasedValue(), contractProjectUnit, contractRecord(), contractSafeText(), remoteContractFailure(), requiredContractPositiveInteger(), booleanValue() (+32 more)

### Community 1 - "SessionData"
Cohesion: 0.09
Nodes (39): handleDoctor(), authHeaders(), AuthSessionRefresh, buildErrorMessage(), DownloadResult, fetchOnTrack(), InvalidDownloadFormatError, InvalidJsonResponseError (+31 more)

### Community 2 - "utils.ts"
Cohesion: 0.07
Nodes (62): countTasksByStatus(), deriveDefaultSubmissionTrigger(), handleUnitTasks(), readAgentTaskShow(), buildPdfFilename(), buildTaskResourceFilename(), colorize(), COLORS_ENABLED (+54 more)

### Community 3 - "cli.ts"
Cohesion: 0.05
Nodes (73): applyLimit(), arrayLength(), buildTaskSelectorArgs(), buildWatchSnapshot(), deriveUnitsFromProjects(), DIGITAL_LOGO_LINES, DoctorCheck, expandHomePath() (+65 more)

### Community 4 - "lightpanda-provider.ts"
Cohesion: 0.07
Nodes (35): main(), readPublicOktaUrl(), requiredLightpandaPath(), cleanupFailure(), defaultFileSystem, defaultRuntime, executableValidationError(), hasExited() (+27 more)

### Community 5 - "agent-commands.ts"
Cohesion: 0.04
Nodes (50): AgentAuthStatus, agentFeedbackItemSchema, AgentFeedbackListInput, agentFeedbackListInputSchema, AgentFeedbackListOutput, agentFeedbackMultilineTextSchema, agentFeedbackTextSchema, agentPlanCalendarDateSchema (+42 more)

### Community 6 - "auto-login.ts"
Cohesion: 0.06
Nodes (46): asErrorMessage(), browserInstallHint(), BrowserLaunchPlan, BrowserStorageEntry, BrowserStorageState, candidateBrowserPaths(), ClaimedBrowserSessionState, clickDetectedMfaOption() (+38 more)

### Community 7 - "contracts.ts"
Cohesion: 0.14
Nodes (25): collectUnexpectedKeys(), collectUnsafePayload(), collectUnsafeShapeEnums(), ContractDrift, ContractFixture, ContractFixtureMetadata, ContractProvenance, ContractRisk (+17 more)

### Community 8 - "main"
Cohesion: 0.15
Nodes (49): agentFeedbackListInputFromSelector(), buildInboxFallbackTasksFromProjectDetails(), dedupeInboxTasks(), describeWatchEvent(), extractInboxProjectId(), flattenTasks(), handleAuthEnsure(), handleAuthMethod() (+41 more)

### Community 9 - "command-spec.ts"
Cohesion: 0.07
Nodes (37): AGENT_TASKS_LIST_MAX_STATUS_LENGTH, agentFeedbackListOutputSchema, agentFeedbackWatchFrameSchema, agentPlanShowInputSchema, agentPlanShowOutputSchema, agentProjectsListInputSchema, agentProjectsListOutputSchema, agentSubmissionStatusOutputSchema (+29 more)

### Community 10 - "submission-lifecycle.ts"
Cohesion: 0.11
Nodes (27): booleanValue(), hasOwnField(), InvalidSubmissionDetailsError, isSubmissionObserved(), journalEntry(), parseStrictSubmissionDetails(), PreparedSubmissionFile, prepareSubmission() (+19 more)

### Community 11 - "handleSubmissionUpload"
Cohesion: 0.14
Nodes (24): agentSubmissionStatusInputFromSelector(), claimConfirmedWrite(), handlePlanCommand(), handlePlanReset(), handlePlanSetDates(), handleSubmissionCommand(), handleSubmissionStatus(), handleSubmissionUpload() (+16 more)

### Community 12 - "student-task-view.ts"
Cohesion: 0.14
Nodes (27): resolveSelectedStudentTask(), buildStudentTaskRows(), BuildStudentTaskViewOptions, buildStudentTaskViews(), definitionsForProject(), definitionTargetGrade(), definitionTutorialStream(), embeddedDefinition() (+19 more)

### Community 13 - "auth-broker.ts"
Cohesion: 0.19
Nodes (11): AuthStatusView, createOnTrackAuthBroker(), defaultDependencies(), OnTrackAuthBrokerDependencies, OnTrackAuthBrokerOptions, sessionFromCapture(), AutoLoginOptions, LoginCredentials (+3 more)

### Community 14 - "scripts"
Cohesion: 0.08
Nodes (26): scripts, build, clean, dev, gitnexus:analyze, gitnexus:check, gitnexus:context, gitnexus:detect-changes (+18 more)

### Community 15 - "discovery.ts"
Cohesion: 0.10
Nodes (33): ProbeResult, API_HINTS, classifyDiscoveredPaths(), contextKeyForParameter(), DEFAULT_DISCOVERY_PROBE_REQUEST_BUDGET, discoverOnTrackSurface(), DiscoveryAsset, DiscoveryResult (+25 more)

### Community 16 - "agent-watch.ts"
Cohesion: 0.11
Nodes (29): agentPlanDateSchema(), hasOwnField(), validateAgentFeedbackWatchFrame(), assertAgentEnvelopeByteLimit(), AgentWatchDate, AgentWatchDateKind, agentWatchDateSchema, AgentWatchDateSource (+21 more)

### Community 17 - "verify-package.ts"
Cohesion: 0.13
Nodes (19): engines, bun, client, expectedTools, transport, assertChildPath(), assertRegularTree(), isAllowedEntry() (+11 more)

### Community 18 - "OnTrack 真实环境变化审计（2026-07-31）"
Cohesion: 0.05
Nodes (41): 10. 仍需进一步验证的未知项, 11. 与本地代码的直接对应, 12. 本轮实施状态与架构决策入口, 13. 最终实施结果, 1. 审计范围, 2.1 保留的核心合同, 2.2 已经失效或明显不足的核心假设, 2. 总体判断 (+33 more)

### Community 19 - "auth-runtime.ts"
Cohesion: 0.17
Nodes (12): AuthInteractionMode, authRequired(), AuthRuntime, AuthRuntimeAdapter, createAuthRuntime(), credentialVersionChanged(), inFlightKey(), isFreshEnough() (+4 more)

### Community 20 - "artifact-safety.ts"
Cohesion: 0.22
Nodes (22): ArtifactOutputOptions, ArtifactPathOptions, ArtifactSafetyError, assertCleanPathInput(), assertNoSymbolicLinkComponents(), assertSafeFilename(), findExternalArtifactPaths(), inspectUploadFile() (+14 more)

### Community 21 - "OnTrack CLI CI/CD 设计"
Cohesion: 0.06
Nodes (33): 10. 已决策与管理面 Gates, 11. 官方来源, 1. 结论与范围, 2. 已核对的事实与约束, 3. 目标流水线, 4.1 `.github/workflows/ci.yml`, 4.2 `.github/workflows/dependency-review.yml`, 4.3 `.github/workflows/release.yml` (+25 more)

### Community 22 - "createAgentTutorialsStatus"
Cohesion: 0.50
Nodes (3): createAgentTutorialsStatus(), tutorialChangeAllowed(), validateTutorialStatus()

### Community 23 - "command-input.ts"
Cohesion: 0.14
Nodes (18): AGENT_GLOBAL_FLAGS, encodeField(), flagOccurrences(), GROUPED_AGENT_COMMANDS, mergeStructuredCommandInput(), parseObject(), readFlagValue(), removeFlagPair() (+10 more)

### Community 24 - "auth-mcp-server.ts"
Cohesion: 0.16
Nodes (15): AuthMcpDependencies, configuredBaseUrl(), createAuthMcpServer(), defaultDependencies(), nextActionSchema, serveAuthMcp(), toolResponse(), ToolResult (+7 more)

### Community 25 - "agent-protocol.ts"
Cohesion: 0.13
Nodes (25): AGENT_SCHEMA_VERSION, AgentArtifact, AgentErrorCode, agentErrorEnvelope(), AgentFailureEnvelope, AgentNextAction, AgentOutputContext, AgentProtocolErrorOptions (+17 more)

### Community 26 - "advanceGuidedSsoOnPage"
Cohesion: 0.19
Nodes (18): advanceGuidedSsoOnPage(), BLOCKED_LINK_HOSTS, canUseSelector(), canUseSelectorInScopes(), clickFirstVisible(), clickLikelyActionControl(), collectScopes(), detectOktaVerifyChallenge() (+10 more)

### Community 27 - "auto-login.test.ts"
Cohesion: 0.18
Nodes (15): buildContextOptionsWithStoredSession(), classifySsoFallback(), clearAllBrowserSessionState(), clearBrowserSessionState(), expandSystemBrowserProfileCandidates(), extractCredentialsFromCookieJar(), extractCredentialsFromUrl(), isLikelyChromiumProfileDir() (+7 more)

### Community 28 - "check-coverage.ts"
Cohesion: 0.22
Nodes (15): assertThreshold(), checkCoverage(), CoverageEvaluation, CoverageMetric, CoverageSummary, CoverageThresholds, evaluateCoverage(), formatMetric() (+7 more)

### Community 29 - "agent-feedback.ts"
Cohesion: 0.13
Nodes (19): AgentTasksListOutput, AgentFeedbackItem, AgentFeedbackListSource, AgentFeedbackTarget, AgentFeedbackTask, AgentFeedbackWatchFrame, completeAgentEnvelopeBytes(), conflict() (+11 more)

### Community 30 - "package.json"
Cohesion: 0.12
Nodes (15): bugs, url, description, files, homepage, license, name, packageManager (+7 more)

### Community 31 - "compilerOptions"
Cohesion: 0.12
Nodes (15): node, src/**/*.ts, compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution, noEmitOnError (+7 more)

### Community 32 - "OnTrack CLI Agent-Ready 实施计划"
Cohesion: 0.07
Nodes (26): 10. 测试矩阵, 11. 发布判断, 1. 产品定位, 2. 核心架构, 3. 不变量, 4.1 成功响应, 4.2 错误与暂停响应, 4. Agent 协议 (+18 more)

### Community 33 - "agent-units.ts"
Cohesion: 0.18
Nodes (13): AgentUnitShowInput, AgentUnitShowOutput, AgentProtocolError, AgentUnitShowSource, assertUnitMetadataMatchesProject(), authoritativeProject(), booleanValue(), completeAgentEnvelopeBytes() (+5 more)

### Community 34 - "auto-login-browser-adapter.test.ts"
Cohesion: 0.22
Nodes (5): BrowserLaunchAdapter, captureSsoCredentials(), captureSsoCredentialsWithGuidedLogin(), FakeBrowserOptions, Handler

### Community 35 - "session.ts"
Cohesion: 0.15
Nodes (18): AcquiredSessionRefreshLock, acquireSessionRefreshLock(), AUTH_REFRESH_LOCK_TIMEOUT, clearSession(), getConfigRoot(), getSessionPath(), isNodeError(), recoverStaleRefreshLock() (+10 more)

### Community 36 - "captureSsoCredentialsInternal"
Cohesion: 0.19
Nodes (13): captureCredentialsFromPersistedStateFile(), captureCredentialsFromStoredBrowserSession(), captureCredentialsFromSystemBrowserProfile(), captureSsoCredentialsInternal(), closeBrowserAtMost(), extractCredentialsFromLocalStorage(), extractCredentialsFromRequestHeaders(), isTargetOnTrackAuthUrl() (+5 more)

### Community 37 - "isBrowserStorageState"
Cohesion: 0.29
Nodes (14): assertTrustedBrowserSessionStateDirectory(), claimBrowserSessionState(), filterBrowserSessionState(), hasReusableBrowserSessionState(), isBrowserStorageCookie(), isBrowserStorageOrigin(), isBrowserStorageState(), isRecord() (+6 more)

### Community 38 - "agent-projects.ts"
Cohesion: 0.27
Nodes (8): AgentProjectsListOutput, contractNonNegativeInteger(), AgentProjectCapabilities, AgentProjectDirectoryItem, booleanValue(), buildAgentProjectsListOutput(), completeAgentEnvelopeBytes(), projectCapabilities()

### Community 39 - "check-skill-lock.ts"
Cohesion: 0.31
Nodes (9): collectFiles(), computeSkillFolderHash(), HashedFile, isRecord(), listInstalledSkillNames(), main(), parseLock(), SkillLock (+1 more)

### Community 41 - "extractCredentialsFromStorageEntries"
Cohesion: 0.43
Nodes (8): extractCredentialsFromAuthPayload(), extractCredentialsFromStorageEntries(), extractCredentialsFromUnknownObject(), extractUsernameFromUserRecord(), hasValue(), normalizeStorageStringValue(), SystemBrowserProfileLocation, tryParseJson()

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

### Community 47 - "watch-snapshots.ts"
Cohesion: 0.15
Nodes (19): settleMetadataReads(), AgentPlanShowOutput, AgentWatchState, AGENT_REMOTE_READ_CONCURRENCY, mapWithConcurrency(), settleWithConcurrency(), getLatestFeedbackTimestamp(), makeWatchTaskKey() (+11 more)

### Community 49 - "check-gitnexus-skill-sync.ts"
Cohesion: 0.50
Nodes (3): packageRecord, packageValue, root

### Community 50 - "Quick start"
Cohesion: 0.20
Nodes (10): 0. Open the interactive launcher, 1. Check the authentication method, 2. Sign in, 3. Confirm the cached account, 4. List projects, units, and tasks, 5. Inspect a specific task, 6. Read feedback and watch live updates, 7. Download PDFs (+2 more)

### Community 51 - "OnTrack CLI 架构重构计划与实施记录（2026-07-31）"
Cohesion: 0.22
Nodes (9): 10. 完成定义, 11. 2026-07-31 实施完成记录, 2.1 真实环境证据, 2.2 当前源码中的耦合, 2. 现状证据与架构判断, 3.1 推荐里程碑, 3.2 可并行项, 3. 依赖图、顺序与可并行项 (+1 more)

### Community 53 - "handleLogin"
Cohesion: 0.20
Nodes (15): downloadTaskResourceArtifacts(), handleLogin(), readAuthStatus(), taskResourceIdentity(), normalizeBaseUrl(), openExternal(), parseSsoRedirectUrl(), promptHidden() (+7 more)

### Community 54 - "agent-contract.ts"
Cohesion: 0.31
Nodes (8): RFC-3339, AGENT_MULTILINE_SAFE_TEXT_PATTERN, AGENT_RFC3339_TIMESTAMP_PATTERN, AGENT_SAFE_TEXT_PATTERN, contractPositiveInteger(), contractRfc3339Timestamp(), contractSafeMultilineText(), isAgentRfc3339Timestamp()

### Community 55 - "repository"
Cohesion: 0.67
Nodes (3): repository, type, url

### Community 60 - "Always Ontrack (ontrack-cli)"
Cohesion: 0.22
Nodes (7): Always Ontrack (ontrack-cli), 功能概览, 当前边界, 测试与验证, 环境变量, 目录, 项目结构

### Community 61 - "快速开始"
Cohesion: 0.22
Nodes (9): 1. 检查认证方式, 2. 登录, 3. 查看当前账号, 4. 列出你的课程和任务, 5. 查看某个具体任务, 6. 查看反馈与实时消息, 7. 下载 PDF, 8. 先预检，再确认上传 submission 或补充文件 (+1 more)

### Community 62 - "createAuthenticatedApi"
Cohesion: 0.17
Nodes (23): buildAgentSubmissionStatusOutput(), createAuthenticatedApi(), createNativeAgentExecutionEngine(), getUnitTaskDefinitions(), hasOwnField(), loadProjectsWithTaskMetadata(), nonEmptyStringValue(), positiveIntegerValue() (+15 more)

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

### Community 68 - "Troubleshooting"
Cohesion: 0.25
Nodes (8): `419 Authentication Timeout`, `Error: 403 Forbidden: Unable to list units`, `Inbox endpoint unavailable ... Showing fallback task list`, `No browser executable found ...`, No color highlighting, `Task abbreviation "... " is ambiguous`, Troubleshooting, Upload key mismatch or incorrect file count

### Community 69 - "Core concepts"
Cohesion: 0.25
Nodes (8): `abbr`, Batch task selectors, Core concepts, `--json`, `project`, `task`, `taskDefinitionId`, `unit`

### Community 70 - "Typical workflows"
Cohesion: 0.25
Nodes (8): Difference between `submission upload` and `submission upload-new-files`, Typical workflows, Upload matching rules, Workflow 1: sign in and find your tasks, Workflow 2: inspect one task end to end, Workflow 3: watch live conversation and status changes, Workflow 4: download PDFs, Workflow 5: upload a submission

### Community 71 - "故障排查"
Cohesion: 0.25
Nodes (8): `419 Authentication Timeout`, `Error: 403 Forbidden: Unable to list units`, `Inbox endpoint unavailable ... Showing fallback task list`, `No browser executable found ...`, `Task abbreviation "... " is ambiguous`, `Upload key mismatch` 或文件数量不匹配, 故障排查, 没有颜色高亮

### Community 72 - "核心概念"
Cohesion: 0.25
Nodes (8): `abbr`, `--json`, `project`, `task`, `taskDefinitionId`, `unit`, 批量任务选择器, 核心概念

### Community 73 - "常见工作流"
Cohesion: 0.25
Nodes (8): submission upload 和 submission upload-new-files 的区别, 上传文件匹配规则, 工作流 1: 第一次登录并找到任务, 工作流 2: 找某个任务的完整上下文, 工作流 3: 实时看聊天和状态变化, 工作流 4: 下载 PDF, 工作流 5: 上传 submission, 常见工作流

### Community 74 - "agent-execution-engine.ts"
Cohesion: 0.13
Nodes (20): AgentBasePolicy, AgentCallRequest, AgentCommandDefinition, AgentCommandManifest, AgentCommandPolicy, AgentExecutionEngineOptions, AgentExecutionEnvelope, AgentNonWritePolicy (+12 more)

### Community 75 - "OnTrack CLI domain context"
Cohesion: 0.29
Nodes (6): Identity, OnTrack CLI domain context, Planning, Production contracts, Student work, Submission

### Community 76 - "Always Ontrack (ontrack-cli)"
Cohesion: 0.29
Nodes (7): Always Ontrack (ontrack-cli), Contents, Current scope, Environment variables, Project structure, Testing and verification, What it does

### Community 77 - "Authentication and session management"
Cohesion: 0.29
Nodes (7): Authentication and session management, Browser-only capture mode: `ontrack login --auto`, Direct token login, Logout, Manual redirect import (backup only), Recommended login: `ontrack login`, What gets cached

### Community 78 - "登录与会话"
Cohesion: 0.29
Nodes (7): 手动 redirect 导入（备用）, 推荐方式: `ontrack login`, 浏览器捕获模式: `ontrack login --auto`, 登录与会话, 登录后会发生什么, 直接传入 token, 退出登录

### Community 79 - "execution-journal.ts"
Cohesion: 0.25
Nodes (17): atomicWrite(), claimExecution(), configRoot(), digest(), ExecutionClaim, executionFingerprint(), ExecutionJournalOptions, ExecutionRecord (+9 more)

### Community 80 - "Command reference"
Cohesion: 0.33
Nodes (6): Account and connectivity, Command reference, Diagnostics and discovery, Feedback and live tracking, PDF and uploads, Units, projects, and tasks

### Community 81 - "Files and directories"
Cohesion: 0.33
Nodes (6): Agent execution journal, Browser refresh state, Build output, Download directory, Files and directories, Session cache

### Community 82 - "Agent-first usage"
Cohesion: 0.33
Nodes (6): Agent-first usage, Apply writes safely, Discover the protocol, Native caller-first interface, Pass structured input, Use the authentication MCP

### Community 83 - "Local development"
Cohesion: 0.33
Nodes (6): Build, Development runs, Install dependencies, Local development, Real-account smoke verification, Run tests

### Community 84 - "Output, highlighting, and JSON"
Cohesion: 0.29
Nodes (7): Agent watch streams, Default output, Force colors on or off, JSON behavior for watch commands, JSON output, Login flow output, Output, highlighting, and JSON

### Community 85 - "文件与目录"
Cohesion: 0.33
Nodes (6): Agent execution journal, Session 缓存, 下载目录, 文件与目录, 构建输出, 浏览器 refresh state

### Community 86 - "Agent-first 使用方式"
Cohesion: 0.33
Nodes (6): Agent-first 使用方式, 传入结构化输入, 使用鉴权 MCP, 原生 caller-first 接口, 发现协议, 安全执行写操作

### Community 87 - "输出、高亮与 JSON"
Cohesion: 0.29
Nodes (7): Agent watch 流, JSON 输出, watch 命令在 `--json` 下的行为, 强制开启或关闭颜色, 登录流程输出, 输出、高亮与 JSON, 默认输出

### Community 88 - "命令总览"
Cohesion: 0.33
Nodes (6): PDF 与上传, 反馈与实时跟踪, 命令总览, 诊断与接口发现, 读取课程、项目、任务, 账号与连接

### Community 89 - "本地开发"
Cohesion: 0.33
Nodes (6): 安装依赖, 开发调试, 本地开发, 构建, 测试, 真实账号烟测

### Community 90 - "whoami.ts"
Cohesion: 0.29
Nodes (8): nonBlankStringValue(), numberValue(), stringValue(), toWhoAmIView(), WhoAmIView, makeSession(), runCliWhoAmI(), secretValues

### Community 91 - "Installation"
Cohesion: 0.40
Nodes (5): Global install, Installation, Local install, Requirements, Run from source

### Community 92 - "安装"
Cohesion: 0.40
Nodes (5): 从源码运行, 全局安装, 安装, 本地安装, 运行环境

### Community 93 - "1. 目标、术语与约束"
Cohesion: 0.50
Nodes (4): 1.1 重构目标, 1.2 强制术语, 1.3 不变量, 1. 目标、术语与约束

### Community 94 - "9. 跨 Module 测试、真实环境验证与回滚"
Cohesion: 0.50
Nodes (4): 9.1 测试金字塔, 9.2 真实环境操作等级, 9.3 回滚原则, 9. 跨 Module 测试、真实环境验证与回滚

### Community 95 - "planner.ts"
Cohesion: 0.15
Nodes (20): buildPlannerViews(), dateFrom(), defaultDate(), gradeDateRow(), integerValue(), parseDateOnly(), personalDate(), PlanDateChange (+12 more)

### Community 96 - "types.ts"
Cohesion: 0.15
Nodes (15): sessionFromAccessTokenCapture(), AuthFailureKind, classifyAuthFailure(), createSessionFromAccessToken(), migrateLegacySession(), OnTrackHttpError, AccessTokenResponse, CredentialSource (+7 more)

### Community 97 - "agent-call-input.ts"
Cohesion: 0.43
Nodes (6): AgentCallInputDependencies, AgentCallInvocation, invalidArgument(), parseAgentCallInvocation(), parseInputObject(), readProcessStdin()

### Community 100 - "contracts.test.ts"
Cohesion: 0.20
Nodes (10): collectShapeDrift(), diffContractShapes(), enumText(), loadContractFixture(), normalizeProductionPayload(), normalizeValue(), SAFE_ENUM_FIELDS, sanitizeProductionPayload() (+2 more)

### Community 101 - "OnTrackAuthBroker"
Cohesion: 0.33
Nodes (3): OnTrackAuthBroker, AuthEnsureOptions, AuthRuntimeResult

### Community 102 - "overrides"
Cohesion: 0.50
Nodes (4): overrides, adm-zip, js-yaml, sharp

### Community 104 - "normalizeReadOnlyRoute"
Cohesion: 0.50
Nodes (4): canonicalRoute(), normalizeReadOnlyRoute(), READ_ONLY_METHODS, ROUTE_CATALOG

### Community 105 - "bin"
Cohesion: 0.67
Nodes (3): bin, ontrack, ontrack-auth-mcp

### Community 106 - "agent-plan.ts"
Cohesion: 0.31
Nodes (18): aliasValues(), buildAgentPlanShowOutput(), calendarDate(), nonNegativeInteger(), normalizePrerequisites(), own(), pairedArray(), pairedBoolean() (+10 more)

### Community 107 - "extractMfaNumberChallengeFromText"
Cohesion: 0.50
Nodes (5): extractMfaNumberChallenge(), extractMfaNumberChallengeFromText(), extractNumberTokens(), hasMfaChallengeSignal(), uniqueInOrder()

## Knowledge Gaps
- **566 isolated node(s):** `name`, `version`, `description`, `license`, `type` (+561 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `client` connect `verify-package.ts` to `auth-mcp-server.ts`?**
  _High betweenness centrality (0.079) - this node is a cross-community bridge._
- **Why does `withClient()` connect `auth-mcp-server.ts` to `verify-package.ts`?**
  _High betweenness centrality (0.079) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _566 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `SessionData` be split into smaller, more focused modules?**
  _Cohesion score 0.08536189548847777 - nodes in this community are weakly interconnected._
- **Should `utils.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07226107226107226 - nodes in this community are weakly interconnected._
- **Should `cli.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.051228070175438595 - nodes in this community are weakly interconnected._
- **Should `lightpanda-provider.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06988120195667366 - nodes in this community are weakly interconnected._