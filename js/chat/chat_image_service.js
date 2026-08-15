// ============================================================
// chat_image_service.js - 聊天图片生成与归档业务层
// ============================================================
// 只处理消息、预设、存储去向和任务并发，不直接拼 DOM。
// 图片卡片通过 generateImageForMessage() 发起手动生成；AI 回复完成后由
// queueAutoImageGeneration() 触发自动生成。任何失败都保留文字描述。

const IMAGE_DESCRIPTION_REGEX = /^\[([^\[\]：:]+?)发来的照片\/视频[:：]\s*([\s\S]+?)\]$/;
const _imageGenerationInflight = new Map();
let _imageGenerationQueueTail = Promise.resolve();
let _imageLocalModeNoticeShown = false;

function parseImageDescriptionMessage(content) {
    const match = String(content || '').match(IMAGE_DESCRIPTION_REGEX);
    if (!match) return null;
    const description = match[2].trim();
    return description ? { sender: match[1].trim(), description } : null;
}

function isImageDescriptionMessage(message) {
    return !!(message && parseImageDescriptionMessage(message.content));
}

function isImageGenerationPending(messageId, chatId = '') {
    if (!messageId) return false;
    if (chatId) return _imageGenerationInflight.has(_imageTaskKey(chatId, messageId));
    const suffix = `:${messageId}`;
    return Array.from(_imageGenerationInflight.keys()).some(key => key.endsWith(suffix));
}

function _imageTargetChat(chatId, chatType) {
    if (chatId && chatType) {
        return chatType === 'private'
            ? (db.characters || []).find(c => c.id === chatId)
            : (db.groups || []).find(g => g.id === chatId);
    }
    if (typeof currentChatId !== 'undefined' && typeof currentChatType !== 'undefined') {
        return currentChatType === 'private'
            ? (db.characters || []).find(c => c.id === currentChatId)
            : (db.groups || []).find(g => g.id === currentChatId);
    }
    return null;
}

function _imageCacheLimit() {
    const raw = Number(db && db.imageSettings && db.imageSettings.localCacheLimitMB);
    return Number.isFinite(raw) && raw >= 0 ? raw : 10;
}

function _imageStorageTarget() {
    try {
        return typeof getGithubBinding === 'function' ? getGithubBinding('image') : null;
    } catch (error) {
        return null;
    }
}

function _imageStorageAvailability() {
    const localEnabled = _imageCacheLimit() > 0 && typeof dexieDB !== 'undefined'
        && dexieDB && dexieDB.imageCache;
    const cloudTarget = _imageStorageTarget();
    return { localEnabled: !!localEnabled, cloudTarget };
}

function getImageStorageAvailability() {
    const availability = _imageStorageAvailability();
    return {
        localEnabled: availability.localEnabled,
        cloudEnabled: !!availability.cloudTarget,
        localCacheLimitMB: _imageCacheLimit()
    };
}

function _safeImageMessageId(messageId) {
    return String(messageId || `msg_${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, '_');
}

function _imageArchivePath(target, messageId, mime) {
    const safeId = _safeImageMessageId(messageId);
    const shard = safeId.replace(/[^a-zA-Z0-9]/g, '').slice(-2).padStart(2, '0');
    const prefix = String((target && target.pathPrefix) || 'image').replace(/\/+$/g, '');
    const ext = typeof imageMimeExtension === 'function' ? imageMimeExtension(mime) : 'jpg';
    return `${prefix}/${shard}/${safeId}.${ext}`;
}

function _imageTaskKey(chatId, messageId) {
    return `${chatId || ''}:${messageId || ''}`;
}

function _enqueueImageTask(task) {
    const run = _imageGenerationQueueTail.then(task, task);
    _imageGenerationQueueTail = run.catch(() => {});
    return run;
}

function _imageChatMessage(message, chatId, chatType) {
    const chat = _imageTargetChat(chatId, chatType);
    if (!chat || !message || !Array.isArray(chat.history)) return null;
    return chat.history.find(item => item && item.id === message.id) || null;
}

async function _saveImageMessage(message, chatId, chatType) {
    if (typeof saveMessageToDB === 'function') await saveMessageToDB(message, chatId, chatType);
    if (typeof saveSingleChat === 'function') await saveSingleChat(chatId, chatType);
}

function _refreshImageMessageBubble(message, chatId, chatType) {
    if (typeof currentChatId === 'undefined' || currentChatId !== chatId
        || typeof currentChatType === 'undefined' || currentChatType !== chatType
        || typeof messageArea === 'undefined' || !messageArea) return;
    const oldBubble = messageArea.querySelector(`.message-wrapper[data-id="${message.id}"]`);
    if (!oldBubble || typeof createMessageBubbleElement !== 'function') return;
    if (typeof releaseImageObjectUrlsWithin === 'function') releaseImageObjectUrlsWithin(oldBubble);
    const nextBubble = createMessageBubbleElement(message);
    if (nextBubble) oldBubble.replaceWith(nextBubble);
}

function _setImageMediaState(message, chatId, chatType, state, extra = {}) {
    const current = message.media && message.media.kind === 'image'
        ? normalizeImageMedia(message.media)
        : createImageMedia({
            source: 'generated',
            state,
            localCacheKey: computeImageCacheKey(chatType, chatId, message.id)
        });
    message.media = normalizeImageMedia({ ...current, state, ...extra });
    return message.media;
}

function _replaceImageMessage(target, source) {
    if (!target || !source) return target;
    Object.keys(target).forEach(key => {
        if (!Object.prototype.hasOwnProperty.call(source, key)) delete target[key];
    });
    Object.assign(target, source);
    return target;
}

function _cloneImageMessage(message) {
    if (!message) return null;
    return {
        ...message,
        parts: Array.isArray(message.parts) ? message.parts.map(part => ({ ...part })) : message.parts,
        media: message.media && typeof message.media === 'object' ? { ...message.media } : message.media
    };
}

async function archiveUploadedImageMessage(message, {
    chatId = '', chatType = '', description = '', senderName = '', dataUrl = '', saveChat = true
} = {}) {
    if (!message || !message.id) {
        throw Object.assign(new Error('图片消息无有效 ID'), { code: 'image-message-missing' });
    }
    const cleanDescription = String(description || '').trim();
    if (!cleanDescription) {
        throw Object.assign(new Error('识图描述为空'), { code: 'image-description-empty' });
    }
    const parsed = typeof _imageBytesFromDataUrl === 'function' ? _imageBytesFromDataUrl(dataUrl) : null;
    if (!parsed || !parsed.bytes || !parsed.bytes.byteLength) {
        throw Object.assign(new Error('原图片数据无效'), { code: 'image-data-invalid' });
    }

    const availability = _imageStorageAvailability();
    if (!availability.localEnabled && !availability.cloudTarget) {
        throw Object.assign(new Error('没有可用的图片保存位置，请开启本地图片缓存或绑定 GitHub 图片仓库'), {
            code: 'image-no-storage'
        });
    }

    const localCacheKey = computeImageCacheKey(chatType, chatId, message.id);
    let localResult = { stored: false, reason: 'local-disabled' };
    if (availability.localEnabled && typeof putImageCache === 'function') {
        try {
            localResult = await putImageCache({
                key: localCacheKey,
                chatId,
                chatType,
                messageId: message.id,
                mime: parsed.mime,
                bytes: parsed.bytes,
                cloudBacked: false,
                protectedKeys: [localCacheKey]
            });
        } catch (error) {
            localResult = { stored: false, reason: 'write-failed', error };
        }
    }

    let cloudResult = null;
    let cloudError = null;
    if (availability.cloudTarget) {
        const cloudPath = _imageArchivePath(availability.cloudTarget, message.id, parsed.mime);
        try {
            if (typeof uploadGithubFile !== 'function') throw new Error('GitHub 上传模块未加载');
            cloudResult = await uploadGithubFile(
                availability.cloudTarget.repo,
                cloudPath,
                parsed.bytes,
                { message: `image: ${message.id}` }
            );
            if (localResult.stored && typeof markImageCacheCloudBacked === 'function') {
                await markImageCacheCloudBacked(localCacheKey);
            }
        } catch (error) {
            cloudError = error;
            console.warn('[图片] 用户图片归档失败：', error.message);
        }
    }

    if (!localResult.stored && !cloudResult) {
        const reason = localResult.reason || 'image-persist-failed';
        const messageText = reason === 'image-too-large'
            ? '原图超过本地缓存上限，且没有成功上传到 GitHub，已保留原图片消息'
            : '原图保存失败，已保留原图片消息，请稍后重试';
        throw Object.assign(new Error(messageText), { code: reason, cause: cloudError || localResult.error });
    }

    const cloud = availability.cloudTarget && cloudResult
        ? {
            cloudState: 'uploaded',
            cloudRepoId: availability.cloudTarget.repo.id || '',
            cloudOwner: availability.cloudTarget.repo.username || '',
            cloudRepo: availability.cloudTarget.repo.repo || '',
            cloudPath: cloudResult.path || _imageArchivePath(availability.cloudTarget, message.id, parsed.mime),
            sha: cloudResult.sha || ''
        }
        : {
            cloudState: availability.cloudTarget ? 'failed' : 'none',
            errorCode: cloudError ? 'image-cloud-upload-failed' : ''
        };
    const newContent = `[${String(senderName || '').trim() || '未知发送者'}发来的照片/视频：${cleanDescription}]`;
    const nextMessage = {
        ...message,
        content: newContent,
        parts: [{ type: 'text', text: newContent }],
        media: createImageMedia({
            source: 'uploaded',
            state: 'ready',
            localCacheKey,
            mime: parsed.mime,
            size: parsed.bytes.byteLength,
            ...cloud,
            errorCode: cloudError ? 'image-cloud-upload-failed' : ''
        })
    };

    const originalMessage = _cloneImageMessage(message);
    const chat = _imageTargetChat(chatId, chatType);
    const memoryMessage = chat && Array.isArray(chat.history)
        ? chat.history.find(item => item && item.id === message.id)
        : null;
    const originalMemoryMessage = memoryMessage && memoryMessage !== message
        ? _cloneImageMessage(memoryMessage)
        : null;
    let messageSaved = false;
    try {
        if (typeof saveMessageToDB === 'function') {
            await saveMessageToDB(nextMessage, chatId, chatType);
            messageSaved = true;
        }
        _replaceImageMessage(message, nextMessage);
        if (memoryMessage && memoryMessage !== message) _replaceImageMessage(memoryMessage, nextMessage);
        if (saveChat && typeof saveSingleChat === 'function') await saveSingleChat(chatId, chatType);
    } catch (error) {
        _replaceImageMessage(message, originalMessage);
        if (memoryMessage && memoryMessage !== message) _replaceImageMessage(memoryMessage, originalMemoryMessage);
        if (messageSaved && typeof saveMessageToDB === 'function') {
            try { await saveMessageToDB(originalMessage, chatId, chatType); } catch (rollbackError) {
                console.error('[图片] 回滚原图片消息失败：', rollbackError);
            }
        }
        if (localResult.stored && typeof deleteImageCache === 'function') {
            await deleteImageCache(localCacheKey);
        }
        throw Object.assign(new Error(`图片消息写库失败，已保留原图：${error.message || '未知错误'}`), {
            code: 'image-message-save-failed', cause: error
        });
    }

    return {
        message,
        media: message.media,
        localStored: !!localResult.stored,
        cloudStored: !!cloudResult,
        localOnly: !!localResult.stored && !cloudResult
    };
}

async function _generateImageForMessage(message, { chatId, chatType, auto = false } = {}) {
    const chat = _imageTargetChat(chatId, chatType);
    if (!chat) throw Object.assign(new Error('找不到这条图片消息所属的聊天'), { code: 'image-chat-missing' });
    const targetMessage = _imageChatMessage(message, chatId, chatType) || message;
    const parsed = parseImageDescriptionMessage(targetMessage.content);
    if (!parsed) throw Object.assign(new Error('这条消息不是标准照片/视频描述'), { code: 'image-description-missing' });

    const preset = typeof resolveImagePresetForChat === 'function'
        ? resolveImagePresetForChat(chat)
        : null;
    if (!preset || !preset.apiKey || !preset.model) {
        throw Object.assign(new Error('当前聊天没有可用的生图预设，请先完成图像 API 设置'), { code: 'image-preset-missing' });
    }

    const availability = _imageStorageAvailability();
    if (!availability.localEnabled && !availability.cloudTarget) {
        throw Object.assign(new Error('图片没有可用的保存位置：请开启本地图片缓存或绑定 GitHub 图片仓库'), { code: 'image-no-storage' });
    }

    const localCacheKey = computeImageCacheKey(chatType, chatId, targetMessage.id);
    _setImageMediaState(targetMessage, chatId, chatType, 'pending', {
        source: 'generated', localCacheKey, presetId: preset.id,
        cloudState: availability.cloudTarget ? 'pending' : 'none', errorCode: ''
    });
    await _saveImageMessage(targetMessage, chatId, chatType);
    _refreshImageMessageBubble(targetMessage, chatId, chatType);

    let generated;
    try {
        generated = await generateImage({ prompt: parsed.description, preset });
    } catch (error) {
        _setImageMediaState(targetMessage, chatId, chatType, 'failed', {
            source: 'generated', localCacheKey, presetId: preset.id,
            cloudState: availability.cloudTarget ? 'failed' : 'none',
            errorCode: error.code || 'image-generation-failed'
        });
        await _saveImageMessage(targetMessage, chatId, chatType);
        _refreshImageMessageBubble(targetMessage, chatId, chatType);
        throw error;
    }

    const bytes = generated && generated.bytes;
    const mime = (generated && generated.mime) || 'image/jpeg';
    if (!bytes || !bytes.byteLength) {
        const error = Object.assign(new Error('生图接口没有返回有效图片'), { code: 'image-empty' });
        _setImageMediaState(targetMessage, chatId, chatType, 'failed', {
            localCacheKey, presetId: preset.id, errorCode: error.code,
            cloudState: availability.cloudTarget ? 'failed' : 'none'
        });
        await _saveImageMessage(targetMessage, chatId, chatType);
        _refreshImageMessageBubble(targetMessage, chatId, chatType);
        throw error;
    }

    let localResult = { stored: false, reason: 'local-disabled' };
    if (availability.localEnabled && typeof putImageCache === 'function') {
        localResult = await putImageCache({
            key: localCacheKey,
            chatId,
            chatType,
            messageId: targetMessage.id,
            mime,
            bytes,
            cloudBacked: false,
            protectedKeys: [localCacheKey]
        });
    }

    let cloudResult = null;
    let cloudError = null;
    if (availability.cloudTarget) {
        const cloudPath = _imageArchivePath(availability.cloudTarget, targetMessage.id, mime);
        try {
            if (typeof uploadGithubFile !== 'function') throw new Error('GitHub 上传模块未加载');
            cloudResult = await uploadGithubFile(
                availability.cloudTarget.repo,
                cloudPath,
                bytes,
                { message: `image: ${targetMessage.id}` }
            );
            if (localResult.stored && typeof markImageCacheCloudBacked === 'function') {
                await markImageCacheCloudBacked(localCacheKey);
            }
        } catch (error) {
            cloudError = error;
            console.warn('[图片] GitHub 归档失败：', error.message);
        }
    }

    const durable = !!localResult.stored || !!cloudResult;
    if (!durable) {
        const error = Object.assign(new Error(
            localResult.reason === 'image-too-large'
                ? '图片超过本地缓存上限，且没有成功上传到 GitHub，未保存真实图片'
                : '真实图片保存失败，描述仍已保留，请稍后重试'
        ), { code: localResult.reason || 'image-persist-failed', cause: cloudError || undefined });
        _setImageMediaState(targetMessage, chatId, chatType, 'failed', {
            source: 'generated', localCacheKey, mime, size: bytes.byteLength,
            presetId: preset.id,
            cloudState: availability.cloudTarget ? 'failed' : 'none',
            errorCode: error.code
        });
        await _saveImageMessage(targetMessage, chatId, chatType);
        _refreshImageMessageBubble(targetMessage, chatId, chatType);
        throw error;
    }

    const cloud = availability.cloudTarget && cloudResult
        ? {
            cloudState: 'uploaded',
            cloudRepoId: availability.cloudTarget.repo.id || '',
            cloudOwner: availability.cloudTarget.repo.username || '',
            cloudRepo: availability.cloudTarget.repo.repo || '',
            cloudPath: cloudResult.path || _imageArchivePath(availability.cloudTarget, targetMessage.id, mime),
            sha: cloudResult.sha || ''
        }
        : {
            cloudState: availability.cloudTarget ? 'failed' : 'none',
            errorCode: cloudError ? 'image-cloud-upload-failed' : ''
        };
    _setImageMediaState(targetMessage, chatId, chatType, 'ready', {
        source: 'generated', localCacheKey, mime, size: bytes.byteLength,
        presetId: preset.id, ...cloud, errorCode: cloudError ? 'image-cloud-upload-failed' : ''
    });
    await _saveImageMessage(targetMessage, chatId, chatType);
    _refreshImageMessageBubble(targetMessage, chatId, chatType);

    if (localResult.stored && !cloudResult && !_imageLocalModeNoticeShown) {
        _imageLocalModeNoticeShown = true;
        if (typeof showToast === 'function') showToast('图片仅保存在当前浏览器，不能随备份恢复，缓存超限后可能被清理');
    }
    return { message: targetMessage, media: targetMessage.media, source: cloudResult ? 'cloud' : 'local' };
}

function generateImageForMessage(message, options = {}) {
    const chatId = options.chatId || (typeof currentChatId !== 'undefined' ? currentChatId : '');
    const chatType = options.chatType || (typeof currentChatType !== 'undefined' ? currentChatType : '');
    const target = _imageChatMessage(message, chatId, chatType) || message;
    if (!target || !target.id) return Promise.reject(new Error('图片消息无有效 ID'));
    const key = _imageTaskKey(chatId, target.id);
    if (_imageGenerationInflight.has(key)) return _imageGenerationInflight.get(key);

    const task = _enqueueImageTask(() => _generateImageForMessage(target, {
        chatId, chatType, auto: !!options.auto
    }));
    _imageGenerationInflight.set(key, task);
    task.finally(() => {
        if (_imageGenerationInflight.get(key) === task) _imageGenerationInflight.delete(key);
    }).catch(() => {});
    return task;
}

/** 每批自动最多取一条，避免一次 AI 回复意外产生多张付费图片。 */
function queueAutoImageGeneration(messages, chat, chatId, chatType) {
    if (!chat || !chat.imageAutoGenerate || !Array.isArray(messages)) return null;
    const message = messages.find(item => isImageDescriptionMessage(item) && !isImageMediaMessage(item));
    if (!message) return null;
    const promise = generateImageForMessage(message, { chatId, chatType, auto: true });
    promise.catch(error => console.warn('[图片] 自动生成失败：', error.message));
    return promise;
}

window.parseImageDescriptionMessage = parseImageDescriptionMessage;
window.isImageDescriptionMessage = isImageDescriptionMessage;
window.isImageGenerationPending = isImageGenerationPending;
window.getImageStorageAvailability = getImageStorageAvailability;
window.archiveUploadedImageMessage = archiveUploadedImageMessage;
window.generateImageForMessage = generateImageForMessage;
window.queueAutoImageGeneration = queueAutoImageGeneration;
