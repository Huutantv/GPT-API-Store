import { userChatCache } from '../conf/cache-manager.js'
import { execSQL } from '../helper/execute-sql.js'
import { getCnyToVnd } from '../helper/exchange-rate.js'
import { userBalanceCache } from '../conf/cache-manager.js'
import { getDoroPricing } from '../helper/doro-price.js'

const DORO_BASE_URL = 'https://us.doro.lol'
const OR_TIMEOUT_MS = 120000

// ─── Map model prefix → provider ────────────────────────────────────────────
const MODEL_PROVIDER_MAP = {
    'claude':   'anthropic',
    'gpt':      'openai',
    'o1':       'openai',
    'o3':       'openai',
    'o4':       'openai',
    'gemini':   'google',
    'deepseek': 'deepseek',
}

const getProviderFromModel = (model = '') => {
    const m = model.toLowerCase()
    for (const [prefix, provider] of Object.entries(MODEL_PROVIDER_MAP)) {
        if (m.startsWith(prefix)) return provider
    }
    return 'anthropic'
}

// ─── Lấy provider key ít được dùng nhất (load balancing) ────────────────────
const getProviderKey = async (provider) => {
    const cacheKey = `providerKey:${provider}`
    const cached = await userBalanceCache.get(cacheKey)
    if (cached) return cached

    const rows = await execSQL(`
        SELECT pk.id, pk.api_key, pr.group_name, pr.markup_rate
        FROM provider_keys pk
        LEFT JOIN provider_ratio pr ON pr.provider = pk.provider
        WHERE pk.is_active = 1 AND pk.provider = ?
        ORDER BY (
            SELECT COUNT(*) FROM usage_transactions
            WHERE provider_key_id = pk.id
            AND create_time > NOW() - INTERVAL 1 HOUR
        ) ASC
        LIMIT 1
    `, [provider])

    const key = rows?.[0] ?? null
    if (key) await userBalanceCache.set(cacheKey, key, '10s')
    return key
}

// ─── Lấy user info từ cache hoặc DB ─────────────────────────────────────────
const getUserInfo = async (apiKey) => {
    const cached = await userChatCache.get(apiKey)
    if (cached) return cached

    const row = await execSQL(`
        SELECT user_id
        FROM user_wallets
        WHERE api_key = ?
    `, [apiKey])

    if (!row?.length) return null

    const userInfo = { user_id: row[0].user_id }
    await userChatCache.set(apiKey, userInfo)
    return userInfo
}

// ─── Lấy balance realtime ────────────────────────────────────────────────────
const getBalance = async (userId) => {
    const cacheKey = `balance:${userId}`
    const cached = await userBalanceCache.get(cacheKey)
    if (cached !== undefined && cached !== null && cached !== 0) return cached

    const row = await execSQL(
        `SELECT balance FROM user_wallets WHERE user_id = ?`,
        [userId]
    )
    const balance = row[0]?.balance ?? 0
    if (balance > 0) {
        await userBalanceCache.set(cacheKey, balance)
    }
    return balance
}

// ─── Tính VND từ CNY ─────────────────────────────────────────────────────────
const calcCostVnd = async (costCny, markupRate) => {
    const cnyToVnd = await getCnyToVnd()
    return Math.ceil(costCny * markupRate * cnyToVnd)
}

// ─── Trừ balance + ghi log ───────────────────────────────────────────────────
const recordUsage = async (userId, orKeyId, model, inputTokens, outputTokens, costVnd) => {
    console.log(`[USAGE] user=${userId} model=${model} | in=${inputTokens} out=${outputTokens} | cost=${costVnd} VND`)

    const updateResult = await execSQL(
        `UPDATE user_wallets
         SET balance = balance - ?
         WHERE user_id = ? AND balance >= ?`,
        [costVnd, userId, costVnd]
    )

    if (updateResult.affectedRows === 0) {
        console.warn(`[BALANCE] Không đủ balance user=${userId} costVnd=${costVnd}`)
        throw new Error('Insufficient balance at deduction time')
    }

    await userBalanceCache.delete(`balance:${userId}`)

    await execSQL(
        `INSERT INTO usage_transactions (usage_id, user_id, provider_key_id, model, input_tokens, output_tokens, cost, create_time) VALUES (UUID(), ?, ?, ?, ?, ?, ?, NOW())`,
        [userId, orKeyId, model, inputTokens, outputTokens, costVnd]
    )
}

// ─── Lưu pending khi billing fail ───────────────────────────────────────────
const savePendingBilling = async (generationId, userId, model, orKeyId, costCny, inputTokens, outputTokens) => {
    await execSQL(
        `INSERT INTO pending_billing (generation_id, user_id, model, provider_key_id, cost_cny, input_tokens, output_tokens)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [generationId, userId, model, orKeyId, costCny, inputTokens, outputTokens]
    ).catch(err => console.error('[PENDING BILLING] Lưu thất bại:', err.message))
}

// ─── Pricing cache từ Doro API ───────────────────────────────────────────────
const calcCostCnyFromTokens = async (model, inputTokens, cachedTokens, cacheCreationTokens, outputTokens, groupName) => {
    const pricing = await getDoroPricing()
    if (!pricing) return 0

    const modelInfo = pricing.modelMap[model]
    if (!modelInfo) {
        console.warn(`[PRICING] Model not found: ${model}, cost=0`)
        return 0
    }

    const groupRatio = pricing.groupRatio[groupName] ?? 1
    const { model_ratio, completion_ratio } = modelInfo

    const CACHE_READ_RATIO     = 0.1
    const CACHE_CREATION_RATIO = 1.25
    const DORO_BASE_RATE       = 2

    console.log(`[CALC] input=${inputTokens} * ${model_ratio} + cached=${cachedTokens} * ${model_ratio} * ${CACHE_READ_RATIO} + cacheCreation=${cacheCreationTokens} * ${model_ratio} * ${CACHE_CREATION_RATIO} + output=${outputTokens} * ${model_ratio} * ${completion_ratio} / 1M * ${groupRatio}`)

    return (
        inputTokens         * model_ratio +
        cachedTokens        * model_ratio * CACHE_READ_RATIO +
        cacheCreationTokens * model_ratio * CACHE_CREATION_RATIO +
        outputTokens        * model_ratio * completion_ratio
    ) / 1_000_000 * groupRatio * DORO_BASE_RATE
} 

const calcCostCnyFromTokensOAI = async (model, inputTokens, cachedTokens, outputTokens, groupName) => {
    const pricing = await getDoroPricing()
    if (!pricing) return 0

    const modelInfo = pricing.modelMap[model]
    if (!modelInfo) {
        console.warn(`[PRICING] Model not found: ${model}, cost=0`)
        return 0
    }

    const groupRatio = pricing.groupRatio[groupName] ?? 1

    const { model_ratio, completion_ratio } = modelInfo
    const normalInput = inputTokens - cachedTokens
    console.log(`[CALC] normalInput=${normalInput} * ${model_ratio} + cached=${cachedTokens} * ${model_ratio} * 0.1 + output=${outputTokens} * ${model_ratio} * ${completion_ratio} / 1M * ${groupRatio}`)
    const CACHE_RATIO = 0.1

    const DORO_BASE_RATE = 2  // $2 per unit model_ratio per 1M tokens

    return (
        normalInput  * model_ratio +
        cachedTokens * model_ratio * CACHE_RATIO +
        outputTokens * model_ratio * completion_ratio
    ) / 1_000_000 * groupRatio * DORO_BASE_RATE
}

const calcCostCnyFromTokensOther = async (model, inputTokens, cachedTokens, outputTokens, groupName) => {
    const pricing = await getDoroPricing()
    if (!pricing) return 0

    const modelInfo = pricing.modelMap[model]
    if (!modelInfo) {
        console.warn(`[PRICING] Model not found: ${model}, cost=0`)
        return 0
    }

    const groupRatio = pricing.groupRatio[groupName] ?? 1
    const { model_ratio, completion_ratio } = modelInfo
    const CACHE_RATIO    = 0.1
    const DORO_BASE_RATE = 2

    // Doro tính: input (toàn bộ) + cache riêng (không trừ) + output
    console.log(`[CALC] input=${inputTokens} * ${model_ratio} + cached=${cachedTokens} * ${model_ratio} * ${CACHE_RATIO} + output=${outputTokens} * ${model_ratio} * ${completion_ratio} / 1M * ${groupRatio}`)

    return (
        inputTokens  * model_ratio +
        cachedTokens * model_ratio * CACHE_RATIO +
        outputTokens * model_ratio * completion_ratio
    ) / 1_000_000 * groupRatio * DORO_BASE_RATE
}

// ═══════════════════════════════════════════════════════════════════════════
// NON-STREAMING
// ═══════════════════════════════════════════════════════════════════════════
const handleNonStream = async (orResponse, userId, orKeyId, model, markupRate, groupName, res) => {
    const data = await orResponse.json()

    const inputTokens  = data?.usage?.input_tokens        ?? 0
    const outputTokens = data?.usage?.output_tokens       ?? 0
    const cachedTokens        = data?.usage?.cache_read_input_tokens        ?? 0
    const cacheCreationTokens = data?.usage?.cache_creation_input_tokens    ?? 0
    const costCny = await calcCostCnyFromTokens(model, inputTokens, cachedTokens, cacheCreationTokens, outputTokens, groupName)

    if (!costCny || costCny === 0) {
        console.warn(`[NO COST] non-stream model=${model} user=${userId}`)
        return res.json(data)
    }

    try {
        const costVnd = await calcCostVnd(costCny, markupRate)
        await recordUsage(userId, orKeyId, model, inputTokens, outputTokens, costVnd)
        console.log(`[BILLED] user=${userId} model=${model} cny=${costCny} vnd=${costVnd}`)
    } catch (err) {
        if (err.message === 'Insufficient balance at deduction time') {
            console.warn(`[BALANCE RACE] non-stream user=${userId}`)
            await savePendingBilling(`nonstream-${Date.now()}`, userId, model, orKeyId, costCny, inputTokens, outputTokens)
        } else {
            console.error('[NON-STREAM BILLING]', err)
        }
    }

    return res.json(data)
}

// ═══════════════════════════════════════════════════════════════════════════
// STREAMING
// ═══════════════════════════════════════════════════════════════════════════
const handleStream = async (orResponse, userId, orKeyId, model, markupRate, groupName, req, res) => {
    res.setHeader('Content-Type',  'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection',    'keep-alive')

    const reader  = orResponse.body.getReader()
    const decoder = new TextDecoder()

    let tokenData = null
    let cancelled = false
    let buffer    = ''          // ← thêm buffer

    req.on('close', () => { cancelled = true })

    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break

            const chunk = decoder.decode(value, { stream: true })
            res.write(chunk)

            buffer += chunk     // ← ghép vào buffer thay vì xử lý chunk trực tiếp

            // Tách ra từng dòng hoàn chỉnh (kết thúc bằng \n)
            const lines = buffer.split('\n')
            buffer = lines.pop() // dòng cuối chưa có \n → giữ lại cho chunk sau

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue
                const raw = line.slice(6).trim()
                if (raw === '[DONE]') continue

                try {
                    const json = JSON.parse(raw)

                    if (json?.usage) {
                        console.log(`[RAW STREAM USAGE] type=${json.type}`, JSON.stringify(json.usage, null, 2))
                    }

                    if (json?.type === 'message_start' && json?.message?.usage) {
                        const u = json.message.usage
                        tokenData = {
                            inputTokens:  u.input_tokens            ?? 0,
                            cachedTokens: u.cache_read_input_tokens ?? 0,
                            outputTokens: 0,
                        }
                    }

                    if (json?.type === 'message_delta' && json?.usage) {
                        if (!tokenData) tokenData = { inputTokens: 0, cachedTokens: 0, cacheCreationTokens: 0, outputTokens: 0 }
                        tokenData.outputTokens        = json.usage.output_tokens               ?? 0
                        tokenData.cachedTokens        = json.usage.cache_read_input_tokens     ?? 0
                        tokenData.cacheCreationTokens = json.usage.cache_creation_input_tokens ?? 0
                        tokenData.inputTokens         = json.usage.input_tokens                ?? tokenData.inputTokens
                    }
                } catch (e) {
                    console.warn('[STREAM PARSE]', e.message, '| raw:', raw.slice(0, 80))
                }
            }
        }
    } finally {
        res.end()
        reader.cancel().catch(() => {})
    }

    // ── Billing (ngoài try/finally, không còn no-unsafe-finally) ──────────
    if (cancelled) console.warn(`[CANCELLED] user=${userId} model=${model}`)

    if (!tokenData || (tokenData.inputTokens === 0 && tokenData.outputTokens === 0)) {
        console.log(`[BILLING] no token data → bỏ qua`)
        return
    }

    console.log(`[TOKEN DEBUG] input=${tokenData.inputTokens} cached=${tokenData.cachedTokens} output=${tokenData.outputTokens}`)

    try {
        const costCny = await calcCostCnyFromTokens(model, tokenData.inputTokens, tokenData.cachedTokens, tokenData.cacheCreationTokens, tokenData.outputTokens, groupName)
        console.log(`[COST DEBUG] costCny=${costCny}`)

        if (!costCny || costCny === 0) {
            console.warn(`[NO COST] stream model=${model} user=${userId}`)
            return
        }

        const costVnd = await calcCostVnd(costCny, markupRate)
        await recordUsage(userId, orKeyId, model, tokenData.inputTokens, tokenData.outputTokens, costVnd)
        console.log(`[BILLED] user=${userId} model=${model} cny=${costCny} vnd=${costVnd} cancelled=${cancelled}`)
    } catch (err) {
        if (err.message === 'Insufficient balance at deduction time') {
            await savePendingBilling(`stream-${Date.now()}`, userId, model, orKeyId, 0, tokenData.inputTokens, tokenData.outputTokens)
        } else {
            console.error('[BILLING-STREAM]', err)
        }
    }
}

// ─── Convert helpers (OpenAI Chat Completions) ───────────────────────────────
const extractTextContent = (content) => {
    if (typeof content === 'string') return content

    if (!Array.isArray(content)) {
        return content?.text ?? content?.input_text ?? content?.output_text ?? ''
    }

    return content
        .map(part => {
            if (typeof part === 'string') return part
            return part?.text ?? part?.input_text ?? part?.output_text ?? ''
        })
        .filter(Boolean)
        .join('\n')
}

const normalizeChatRole = (role) => {
    if (role === 'developer' || role === 'system') return 'system'
    if (role === 'assistant') return 'assistant'
    if (role === 'tool') return 'tool'
    return 'user'
}

const convertInputToChatMessages = (input = [], instructions = '') => {
    const messages = []

    if (instructions) {
        messages.push({ role: 'system', content: instructions })
    }

    const items = Array.isArray(input) ? input : [input]

    for (const item of items) {
        if (typeof item === 'string') {
            if (item.trim()) messages.push({ role: 'user', content: item })
            continue
        }

        if (!item || typeof item !== 'object') continue

        if (item.type === 'function_call') {
            messages.push({
                role: 'assistant',
                content: null,
                tool_calls: [{
                    id: item.call_id ?? item.id ?? `call_${Date.now()}`,
                    type: 'function',
                    function: {
                        name: item.name,
                        arguments: typeof item.arguments === 'string'
                            ? item.arguments
                            : JSON.stringify(item.arguments ?? {}),
                    },
                }],
            })
            continue
        }

        if (item.type === 'function_call_output') {
            messages.push({
                role: 'tool',
                tool_call_id: item.call_id,
                content: extractTextContent(item.output ?? item.content),
            })
            continue
        }

        if (item.type && item.type !== 'message') continue

        const role = normalizeChatRole(item.role)
        const content = extractTextContent(item.content ?? item.text ?? item.input_text)
        if (!content?.trim()) continue
        messages.push({ role, content })
    }

    return messages
}

const convertResponsesToolsToChatTools = (tools = []) => {
    if (!Array.isArray(tools)) return []

    return tools
        .filter(tool => tool?.type === 'function')
        .map(tool => {
            if (tool.function?.name) return tool
            return {
                type: 'function',
                function: {
                    name: tool.name,
                    description: tool.description ?? '',
                    parameters: tool.parameters ?? { type: 'object', properties: {} },
                },
            }
        })
        .filter(tool => tool.function?.name)
}

const chatUsageToResponsesUsage = (usage = {}) => {
    const inputTokens  = usage.prompt_tokens     ?? usage.input_tokens  ?? 0
    const outputTokens = usage.completion_tokens ?? usage.output_tokens ?? 0

    return {
        input_tokens:  inputTokens,
        output_tokens: outputTokens,
        total_tokens:  usage.total_tokens ?? inputTokens + outputTokens,
    }
}

const chatCompletionToResponses = (data, model) => {
    const now        = Date.now()
    const responseId = data?.id?.startsWith?.('resp_') ? data.id : `resp_${now}`
    const outputId   = `msg_${now}`
    const message    = data?.choices?.[0]?.message ?? {}
    const text       = typeof message.content === 'string' ? message.content : ''
    const output     = []

    if (text) {
        output.push({
            id: outputId,
            type: 'message',
            status: 'completed',
            role: 'assistant',
            content: [{ type: 'output_text', text, annotations: [] }],
        })
    }

    for (const call of message.tool_calls ?? []) {
        output.push({
            type: 'function_call',
            id: call.id,
            call_id: call.id,
            name: call.function?.name,
            arguments: call.function?.arguments ?? '{}',
            status: 'completed',
        })
    }

    return {
        id: responseId,
        object: 'response',
        created_at: data?.created ?? Math.floor(now / 1000),
        status: 'completed',
        model,
        output,
        output_text: text,
        usage: chatUsageToResponsesUsage(data?.usage),
    }
}

const sendResponsesEvent = (res, event, data) => {
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
}

const responsesStreamPayload = (responseId, type, data = {}) => ({
    type,
    response_id: responseId,
    ...data,
})

// ═══════════════════════════════════════════════════════════════════════════
// RESPONSES API - Non-stream (OpenAI)
// ═══════════════════════════════════════════════════════════════════════════
const handleResponsesNonStreamOAI = async (orResponse, model, res) => {
    const data = await orResponse.json()

    if (data?.object === 'response') {
        return res.json(data)
    }

    if (!Array.isArray(data?.choices)) {
        console.error('[RESPONSES ERROR] Unexpected upstream response:', data)
        return res.status(502).json({
            error: {
                message: 'Unexpected upstream response format',
                type: 'api_error',
            },
        })
    }

    return res.json(chatCompletionToResponses(data, model))
}

// ═══════════════════════════════════════════════════════════════════════════
// RESPONSES API - Stream (OpenAI)
// ═══════════════════════════════════════════════════════════════════════════
const handleResponsesStreamOAI = async (orResponse, userId, orKeyId, model, markupRate, groupName, req, res) => {
    res.setHeader('Content-Type',  'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection',    'keep-alive')

    const reader     = orResponse.body.getReader()
    const decoder    = new TextDecoder()
    const responseId = `resp_${Date.now()}`

    let inputTokens  = 0
    let outputTokens = 0
    let cachedTokens = 0
    let cancelled    = false

    req.on('close', () => { cancelled = true })

    const sendEvent = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    sendEvent('response.created', {
        type: 'response.created',
        response: { id: responseId, object: 'response', model, status: 'in_progress' },
    })
    sendEvent('response.output_item.added', {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'message', role: 'assistant', content: [] },
    })
    sendEvent('response.content_part.added', {
        type: 'response.content_part.added',
        item_id: responseId, output_index: 0, content_index: 0,
        part: { type: 'output_text', text: '' },
    })

    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break

            const chunk = decoder.decode(value, { stream: true })

            for (const line of chunk.split('\n')) {
                if (!line.startsWith('data: ')) continue
                const raw = line.slice(6).trim()
                if (raw === '[DONE]') continue
                try {
                    const json = JSON.parse(raw)

                    // Doro trả về chat.completion.chunk format
                    const delta = json?.choices?.[0]?.delta?.content
                    if (delta) {
                        sendEvent('response.output_text.delta', {
                            type: 'response.output_text.delta',
                            item_id: responseId, output_index: 0, content_index: 0,
                            delta,
                        })
                    }

                    if (json?.usage) {
                        inputTokens  = json.usage.prompt_tokens     ?? 0
                        outputTokens = json.usage.completion_tokens ?? 0
                        cachedTokens = json.usage.prompt_tokens_details?.cached_tokens ?? 0
                    }
                } catch {
                    console.warn('[STREAM PARSE]', raw)  // ← cái này đã có rồi, không sao
                }
            }
        }
    } finally {
        sendEvent('response.content_part.done', {
            type: 'response.content_part.done',
            item_id: responseId, output_index: 0, content_index: 0,
            part: { type: 'output_text', text: '' },
        })
        sendEvent('response.output_item.done', {
            type: 'response.output_item.done',
            output_index: 0,
            item: { type: 'message', role: 'assistant', content: [] },
        })
        sendEvent('response.completed', {
            type: 'response.completed',
            response: {
                id: responseId, object: 'response', model, status: 'completed',
                usage: {
                    input_tokens:  inputTokens,
                    output_tokens: outputTokens,
                    total_tokens:  inputTokens + outputTokens,
                },
            },
        })

        res.write('data: [DONE]\n\n')
        res.end()
        reader.cancel().catch(() => {})

        console.log(`[TOKEN DEBUG] input=${inputTokens} cached=${cachedTokens} output=${outputTokens}`)
        const costCny = await calcCostCnyFromTokensOAI(model, inputTokens, cachedTokens, outputTokens, groupName)
        console.log(`[COST DEBUG] costCny=${costCny}`)
        if (costCny > 0) {
            try {
                const costVnd = await calcCostVnd(costCny, markupRate)
                await recordUsage(userId, orKeyId, model, inputTokens, outputTokens, costVnd)
                console.log(`[RESPONSES OAI BILLED] user=${userId} model=${model} cny=${costCny} vnd=${costVnd} cancelled=${cancelled}`)
            } catch (err) {
                if (err.message === 'Insufficient balance at deduction time') {
                    await savePendingBilling(`responses-oai-stream-${Date.now()}`, userId, model, orKeyId, costCny, inputTokens, outputTokens)
                } else {
                    console.error('[RESPONSES OAI BILLING-STREAM]', err)
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// RESPONSES API - Main handler
// ═══════════════════════════════════════════════════════════════════════════
const handleResponsesStreamForCodex = async (orResponse, model, req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')

    const reader     = orResponse.body.getReader()
    const decoder    = new TextDecoder()
    const responseId = `resp_${Date.now()}`
    const outputId   = `msg_${Date.now()}`

    let inputTokens  = 0
    let outputTokens = 0
    let outputText   = ''
    let buffer       = ''
    let cancelled    = false

    req.on('close', () => { cancelled = true })

    const responseBase = {
        id: responseId,
        object: 'response',
        created_at: Math.floor(Date.now() / 1000),
        model,
    }

    sendResponsesEvent(res, 'response.created', {
        type: 'response.created',
        response: { ...responseBase, status: 'in_progress', output: [] },
    })
    sendResponsesEvent(res, 'response.in_progress', {
        type: 'response.in_progress',
        response: { ...responseBase, status: 'in_progress', output: [] },
    })
    sendResponsesEvent(res, 'response.output_item.added', responsesStreamPayload(responseId, 'response.output_item.added', {
        output_index: 0,
        item: { id: outputId, type: 'message', status: 'in_progress', role: 'assistant', content: [] },
    }))
    sendResponsesEvent(res, 'response.content_part.added', responsesStreamPayload(responseId, 'response.content_part.added', {
        item_id: outputId,
        output_index: 0,
        content_index: 0,
        part: { type: 'output_text', text: '', annotations: [] },
    }))

    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue
                const raw = line.slice(6).trim()
                if (!raw || raw === '[DONE]') continue

                try {
                    const json = JSON.parse(raw)
                    const delta = json?.choices?.[0]?.delta?.content

                    if (delta) {
                        outputText += delta
                        sendResponsesEvent(res, 'response.output_text.delta', responsesStreamPayload(responseId, 'response.output_text.delta', {
                            item_id: outputId,
                            output_index: 0,
                            content_index: 0,
                            delta,
                        }))
                    }

                    if (json?.usage) {
                        inputTokens  = json.usage.prompt_tokens     ?? 0
                        outputTokens = json.usage.completion_tokens ?? 0
                    }
                } catch (err) {
                    console.warn('[RESPONSES STREAM PARSE]', err.message, '| raw:', raw.slice(0, 120))
                }
            }
        }
    } finally {
        const finalMessage = {
            id: outputId,
            type: 'message',
            status: 'completed',
            role: 'assistant',
            content: [{ type: 'output_text', text: outputText, annotations: [] }],
        }
        const finalResponse = {
            ...responseBase,
            status: cancelled ? 'cancelled' : 'completed',
            output: [finalMessage],
            output_text: outputText,
            usage: {
                input_tokens: inputTokens,
                output_tokens: outputTokens,
                total_tokens: inputTokens + outputTokens,
            },
        }

        sendResponsesEvent(res, 'response.output_text.done', responsesStreamPayload(responseId, 'response.output_text.done', {
            item_id: outputId,
            output_index: 0,
            content_index: 0,
            text: outputText,
        }))
        sendResponsesEvent(res, 'response.content_part.done', responsesStreamPayload(responseId, 'response.content_part.done', {
            item_id: outputId,
            output_index: 0,
            content_index: 0,
            part: { type: 'output_text', text: outputText, annotations: [] },
        }))
        sendResponsesEvent(res, 'response.output_item.done', responsesStreamPayload(responseId, 'response.output_item.done', {
            output_index: 0,
            item: finalMessage,
        }))
        sendResponsesEvent(res, cancelled ? 'response.cancelled' : 'response.completed', {
            type: cancelled ? 'response.cancelled' : 'response.completed',
            response: finalResponse,
        })

        res.write('event: done\ndata: [DONE]\n\n')
        res.end()
        reader.cancel().catch(() => {})
    }
}

const handleResponses = async (req, res, userId) => {
    const body     = req.body
    const model    = body.model ?? 'gpt-5.5'
    const isStream = body.stream === true

    const providerKey = await getProviderKey('openai')
    if (!providerKey) {
        return res.status(503).json({ error: 'No active key for provider: openai' })
    }
    console.log(`[RESPONSES] user=${userId} model=${model} stream=${isStream}`)

    const messages = Array.isArray(body.messages)
        ? body.messages
        : convertInputToChatMessages(body.input ?? [], body.instructions ?? '')

    if (!messages.length) {
        return res.status(400).json({ error: 'No messages found in input' })
    }

    const tools = convertResponsesToolsToChatTools(body.tools)
    const payload = {
        model,
        messages,
        stream: isStream,
        ...(isStream ? { stream_options: { include_usage: true } } : {}),
        ...(tools.length ? { tools } : {}),
        ...(body.tool_choice ? { tool_choice: body.tool_choice } : {}),
        ...(body.max_output_tokens ?? body.max_tokens ? { max_tokens: body.max_output_tokens ?? body.max_tokens } : {}),
        ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
        ...(body.top_p !== undefined ? { top_p: body.top_p } : {}),
        ...(body.presence_penalty !== undefined ? { presence_penalty: body.presence_penalty } : {}),
        ...(body.frequency_penalty !== undefined ? { frequency_penalty: body.frequency_penalty } : {}),
        ...(body.response_format ? { response_format: body.response_format } : {}),
    }

    let orResponse
    try {
        orResponse = await fetch(`${DORO_BASE_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${providerKey.api_key}`,
                'Content-Type':  'application/json',
                'HTTP-Referer':  process.env.APP_URL  ?? 'http://localhost:3000',
                'X-Title':       process.env.APP_NAME ?? 'AIKey',
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(OR_TIMEOUT_MS),
        })
    } catch (err) {
        if (err.name === 'TimeoutError') {
            return res.status(504).json({ error: 'Doro timeout' })
        }
        throw err
    }

    if (!orResponse.ok) {
        const errBody = await orResponse.json().catch(() => ({}))
        console.error(`[RESPONSES ERROR] status=${orResponse.status}`, errBody)
        return res.status(orResponse.status).json({ error: 'Doro error', detail: errBody })
    }

    if (isStream) {
        return await handleResponsesStreamForCodex(orResponse, model, req, res)
    } else {
        return await handleResponsesNonStreamOAI(orResponse, model, res)
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════

const handleNonStreamOther = async (orResponse, userId, orKeyId, model, markupRate, groupName, res) => {
    const data = await orResponse.json()

    const inputTokens  = data?.usage?.prompt_tokens     ?? 0
    const outputTokens = data?.usage?.completion_tokens ?? 0
    const cachedTokens = data?.usage?.prompt_tokens_details?.cached_tokens ?? 0
    const costCny = await calcCostCnyFromTokensOther(model, inputTokens, cachedTokens, outputTokens, groupName)

    if (costCny > 0) {
        try {
            const costVnd = await calcCostVnd(costCny, markupRate)
            await recordUsage(userId, orKeyId, model, inputTokens, outputTokens, costVnd)
            console.log(`[BILLED OAI] user=${userId} model=${model} cny=${costCny} vnd=${costVnd}`)
        } catch (err) {
            if (err.message === 'Insufficient balance at deduction time') {
                await savePendingBilling(`oai-nonstream-${Date.now()}`, userId, model, orKeyId, costCny, inputTokens, outputTokens)
            } else {
                console.error('[NON-STREAM OAI BILLING]', err)
            }
        }
    }

    return res.json(data)
}

const handleStreamOther = async (orResponse, userId, orKeyId, model, markupRate, groupName, req, res) => {
    res.setHeader('Content-Type',  'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection',    'keep-alive')

    const reader  = orResponse.body.getReader()
    const decoder = new TextDecoder()

    let inputTokens  = 0
    let outputTokens = 0
    let cachedTokens = 0
    let cancelled    = false

    req.on('close', () => { cancelled = true })

    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break

            const chunk = decoder.decode(value, { stream: true })
            res.write(chunk)

            for (const line of chunk.split('\n')) {
                if (!line.startsWith('data: ')) continue
                const raw = line.slice(6).trim()
                if (raw === '[DONE]') continue
                
                const json = JSON.parse(raw)
                if (json?.usage) {
                    inputTokens  = json.usage.prompt_tokens     ?? 0
                    outputTokens = json.usage.completion_tokens ?? 0
                    cachedTokens = json.usage.prompt_tokens_details?.cached_tokens ?? 0
                }
            }
        }
    } finally {
        res.end()
        reader.cancel().catch(() => {})
    }

    console.log(`[TOKEN DEBUG OAI] input=${inputTokens} cached=${cachedTokens} output=${outputTokens}`)

    if (!inputTokens && !outputTokens) {
        console.warn(`[BILLING OAI] no token data → bỏ qua`)
        return
    }

    try {
        const costCny = await calcCostCnyFromTokensOther(model, inputTokens, cachedTokens, outputTokens, groupName)
        console.log(`[COST DEBUG OAI] costCny=${costCny}`)
        if (!costCny) return
        const costVnd = await calcCostVnd(costCny, markupRate)
        await recordUsage(userId, orKeyId, model, inputTokens, outputTokens, costVnd)
        console.log(`[BILLED OAI] user=${userId} model=${model} cny=${costCny} vnd=${costVnd} cancelled=${cancelled}`)
    } catch (err) {
        if (err.message === 'Insufficient balance at deduction time') {
            await savePendingBilling(`oai-stream-${Date.now()}`, userId, model, orKeyId, 0, inputTokens, outputTokens)
        } else {
            console.error('[BILLING OAI STREAM]', err)
        }
    }
}

const userChat = async (req, res) => {
    try {
        // 1. Lấy api_key
        const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '').trim()
        if (!apiKey) {
            return res.status(401).json({ error: 'Missing Authorization header' })
        }

        // 2. Validate key → lấy user_id
        const user = await getUserInfo(apiKey)
        if (!user) {
            return res.status(401).json({ error: 'Invalid API key' })
        }

        // 3. Check balance chung
        const balance = await getBalance(user.user_id)
        if (balance <= 0) {
            return res.status(402).json({ error: 'Insufficient balance', balance })
        }

        // 4. Xác định subPath
        const subPath = '/' + (req.params.path?.[0] ?? req.params[0] ?? '')

        // 5. Responses API
        if (subPath === '/responses' || subPath === '/v1/responses') {
            return await handleResponses(req, res, user.user_id)
        }

        // 6. Validate model
        const model = req.body?.model
        if (!model) {
            return res.status(400).json({ error: 'Missing model in request body' })
        }

        // 7. Detect provider → lấy key phù hợp
        const provider = getProviderFromModel(model)
        const providerKey = await getProviderKey(provider)
        if (!providerKey) {
            return res.status(503).json({ error: `No active key for provider: ${provider}` })
        }
        const markupRate = providerKey.markup_rate ?? 3

        // 8. Giới hạn kích thước request body
        const parsedBody = { ...req.body }
        if (parsedBody.max_tokens && parsedBody.max_tokens < 16) {
            parsedBody.max_tokens = 16
        }

        let doroUrl
        let bodyToSend

        if (model.startsWith('gemini') || model.startsWith('deepseek') || model.startsWith('gpt')) {
            doroUrl    = `${DORO_BASE_URL}/v1/chat/completions`
            bodyToSend = JSON.stringify(req.body)  // giữ nguyên OpenAI format
        } else {
            // Claude và các model Anthropic
            doroUrl    = `${DORO_BASE_URL}/v1/messages`
            bodyToSend = JSON.stringify(req.body)
        }

        // Bỏ bodyStr cũ, dùng bodyToSend
        if (bodyToSend.length > 1_000_000) {
            return res.status(400).json({ error: 'Request body too large (max 1Mb)' })
        }

        const isStream = req.body?.stream === true
        const orResponse = await fetch(doroUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${providerKey.api_key}`,
                'Content-Type':  'application/json',
                'HTTP-Referer':  process.env.APP_URL  ?? 'http://localhost:3000',
                'X-Title':       process.env.APP_NAME ?? 'AIKey',
            },
            body: bodyToSend,
            signal: AbortSignal.timeout(OR_TIMEOUT_MS),
        })

        // 10. Xử lý lỗi từ Doro
        if (!orResponse.ok) {
            const errBody = await orResponse.json().catch(() => ({}))
            console.error(`[DORO ERROR] status=${orResponse.status} model=${model} body=`, JSON.stringify(errBody))

            if (orResponse.status === 429) {
                console.warn(`[RATE LIMIT] or_key_id=${providerKey.id} user=${user.user_id}`)
            }

            if (orResponse.status === 402) {
                await execSQL(
                    `UPDATE provider_keys SET is_active = 0 WHERE id = ?`,
                    [providerKey.id]
                )
                console.error(`[KEY DISABLED] or_key_id=${providerKey.id} hết quota`)
            }

            return res.status(orResponse.status).json({
                error:  'Doro error',
                detail: errBody,
            })
        }

        if (isStream) {
            if (model.startsWith('claude')) {
                return await handleStream(orResponse, user.user_id, providerKey.id, model, markupRate, providerKey.group_name, req, res)
            } else {
                return await handleStreamOther(orResponse, user.user_id, providerKey.id, model, markupRate, providerKey.group_name, req, res)
            }
        } else {
            if (model.startsWith('claude')) {
                return await handleNonStream(orResponse, user.user_id, providerKey.id, model, markupRate, providerKey.group_name, res)
            } else {
                return await handleNonStreamOther(orResponse, user.user_id, providerKey.id, model, markupRate, providerKey.group_name, res)
            }
        }

    } catch (err) {
        if (err.name === 'TimeoutError') {
            console.error(`[TIMEOUT] Doro không phản hồi sau ${OR_TIMEOUT_MS}ms`)
            if (!res.headersSent) {
                return res.status(504).json({ error: 'Doro timeout' })
            }
            return
        }
        console.error('[userChat ERROR]', err)
        if (!res.headersSent) {
            return res.status(500).json({ error: 'Internal server error' })
        }
    }
}

// ─── Invalidate cache khi admin disable key ──────────────────────────────────
const invalidateUserCache = (apiKey) => {
    userChatCache.del(apiKey)
}

// Warm pricing cache khi server khởi động
getDoroPricing().then(() => console.log('[PRICING] Cache warmed'))

export { userChat, invalidateUserCache }
