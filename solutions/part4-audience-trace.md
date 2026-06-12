# Part 4: Audience 数据缺失 — 调用链路追踪报告

> ⚡ 请在动手修复之前完成此报告。

## 1. 调用链路追踪

追踪一个请求从发起到结果返回的完整路径。对比 **成功请求** 和 **失败请求** 在每一层的数据差异。

### 成功请求（例: mediaId=67890）

| 层级 | 文件 : 行号 | 输入数据 | 输出数据 |
|------|-----------|---------|---------|
| Runner | run-audience-test.ts : L24-L28, L41 | `{ instagram_id: "67890", tiktok_id: "11111" }` | 调用 `batchFetchAudienceData(...)`，最终 `67890` 进入 success results。 |
| AudienceService | audience.service.ts : L98-L101 | `platform="instagram"`, `mediaId="67890"` | `fetchAudienceData(...)` 返回 unified audience data。 |
| FacadeService | facade-audience.service.ts : L31-L70 | GET `/api/v1/audience?media_type=instagram&media_id=67890` | 从 `audienceData.data.audience` 提取到 demographics。 |
| MockAPI | mock-audience-api.ts : L67-L99 | `media_id=67890` | 返回 standard response: `{ status, data: { audience, meta } }`。 |

### 失败请求（mediaId=12345）

| 层级 | 文件 : 行号 | 输入数据 | 输出数据 |
|------|-----------|---------|---------|
| Runner | run-audience-test.ts : L24-L28, L41 | `{ instagram_id: "12345" }` | 调用 `batchFetchAudienceData(...)`，最终 `12345` 进入 errors。 |
| AudienceService | audience.service.ts : L98-L101 | `platform="instagram"`, `mediaId="12345"` | `fetchAudienceData(...)` 收到 `null`，记录 `{ platform: "instagram", mediaId: "12345" }` error。 |
| FacadeService | facade-audience.service.ts : L59-L75 | API 返回 `status="success"`，但结构是 legacy | `audienceData.data?.audience` 为 `undefined`，返回 `undefined/null` 给上层。 |
| MockAPI | mock-audience-api.ts : L48-L64 | `media_id=12345` | 返回 legacy response: `{ status, audience_data: { demographics } }`。 |

## 2. 数据结构差异分析

请对比成功和失败请求中，**第三方 API 返回的原始数据结构**有什么不同：

```json
// 成功请求的 API 响应结构:
{
  "status": "success",
  "data": {
    "audience": {
      "gender": [{ "label": "male", "value": 0.42 }],
      "age": [{ "label": "18-24", "value": 0.35 }],
      "geography": {
        "countries": [{ "name": "United States", "code": "US", "percentage": 45.5 }]
      }
    },
    "meta": {
      "media_id": "67890",
      "platform": "instagram",
      "last_updated": "..."
    }
  }
}

// 失败请求的 API 响应结构:
{
  "status": "success",
  "audience_data": {
    "demographics": {
      "gender": [
        { "label": "male", "value": 0.45 },
        { "label": "female", "value": 0.55 }
      ]
    }
  }
}
```

**差异在哪一行代码导致了 null？**

```
文件: apps/worker-service/src/audience-integration/facade-audience.service.ts
行号: 修复前 L70
代码: const extracted = audienceData.data?.audience;
原因: 这行只支持 standard response 的 data.audience 路径。mediaId=12345 返回的是 legacy response，demographics 位于 audience_data.demographics，因此提取结果为 undefined，上层 AudienceService 将其当成 No data returned。
```

## 3. 修复方案

在 Facade 层加入 response extractor registry，而不是在业务层理解所有第三方历史格式。

- `standard-v1`: 提取 `response.data.audience`。
- `legacy-demographics`: 提取 `response.audience_data.demographics`。
- 每个 extractor 有明确名称，成功时记录使用了哪个 extractor。
- 如果所有 extractor 都失败，不做猜测映射，只记录顶层 keys 和已尝试 extractor，方便人工确认后新增适配规则。

这个修复边界保持在 Facade 层：`AudienceService` 继续只处理统一后的 audience payload，不关心第三方 API 的 shape 变体。

## 4. 扩展性设计（进阶）

如果要增加 `youtube`, `twitter`, `linkedin` 三个新平台：

### 当前代码结构的问题

- `AudienceService.batchFetchAudienceData` 对 `instagram_id` 和 `tiktok_id` 写死了两个 `if`，新增平台会继续堆分支。
- `FacadeAudienceService.getAudienceV1ByPlaywright` 的 `mediaType` 类型也写死为 `'instagram' | 'tiktok'`。
- Facade 提取逻辑原来只有单一路径 `data.audience`，无法表达多个 provider/version 的响应结构。

### 你的设计方案

使用两层可枚举配置降低耦合：

1. 平台层：用 `PLATFORM_ID_FIELDS` 描述当前已验证平台和 influencer id 字段的关系。新增 `youtube/twitter/linkedin` 时，先完成第三方 API 验证和测试覆盖，再扩展配置，不改批处理核心循环。
2. 响应结构层：用 `AUDIENCE_EXTRACTORS` 描述已确认的第三方响应结构。新结构出现时先记录失败样本，人工确认语义后新增 extractor。

```typescript
const PLATFORM_ID_FIELDS = {
  instagram: 'instagram_id',
  tiktok: 'tiktok_id',
  // future, after API support and tests are verified:
  // youtube: 'youtube_id',
  // twitter: 'twitter_id',
  // linkedin: 'linkedin_id',
};

const AUDIENCE_EXTRACTORS = [
  { name: 'standard-v1', extract: response => response.data?.audience },
  { name: 'legacy-demographics', extract: response => response.audience_data?.demographics },
];
```

## 5. 验收结果

```bash
pnpm simulate:audience-bug
```

关键输出：

```text
[FacadeService] Extracted audience using standard-v1 for instagram:67890
[FacadeService] Extracted audience using standard-v1 for tiktok:11111
[FacadeService] Extracted audience using legacy-demographics for instagram:12345
[FacadeService] Extracted audience using standard-v1 for instagram:99999
[FacadeService] Extracted audience using standard-v1 for tiktok:22222

============================================================
📈 RESULTS
============================================================
✅ Success: 5 requests
❌ Errors: 0
```
