// ============================================================
// chat_image_settings.js - shared image-generation binding UI
// ============================================================
// This module only owns chat-level selection and display. It does not
// generate images or decide when the chat runtime should call the API.

/** Normalize a private-chat or group-chat image binding. */
function normalizeChatImageBinding(chat, settings) {
    const source = chat || {};
    const selected = typeof getImagePreset === 'function'
        ? getImagePreset(source.imageApiPresetId, settings)
        : null;

    return {
        imageApiPresetId: selected ? selected.id : '',
        imageAutoGenerate: !!source.imageAutoGenerate
    };
}

/** Display label for the sidebar row. Empty or stale IDs follow the global default. */
function formatImageGenerationSettingLabel(presetId = '', autoGenerate = false, settings) {
    if (typeof resolveImagePreset !== 'function') return '未配置';
    const resolved = resolveImagePreset(presetId, settings);
    if (!resolved) return '未配置';

    const mode = autoGenerate ? '自动' : '手动';
    return `${resolved.name} · ${mode}`;
}

/** Open the same image-generation settings form for private and group chats. */
async function openImageGenerationSettingDialog(current = {}) {
    if (typeof getImagePresetOptions !== 'function') return null;

    const binding = normalizeChatImageBinding(current);
    const result = await AppUI.form([
        {
            type: 'select',
            key: 'preset',
            label: '图像 API 预设',
            options: getImagePresetOptions(),
            value: binding.imageApiPresetId
        },
        {
            type: 'switch',
            key: 'auto',
            label: '自动生成图片',
            value: binding.imageAutoGenerate
        },
        {
            type: 'note',
            key: 'imageHint',
            label: '说明',
            value: '关闭自动生成后，照片描述卡仍会出现，可手动点击生成。'
        }
    ], { title: '图像生成', confirmText: '保存', cancelText: '取消' });

    if (!result) return null;
    const selected = typeof getImagePreset === 'function'
        ? getImagePreset(result.preset)
        : null;

    return {
        imageApiPresetId: selected ? selected.id : '',
        imageAutoGenerate: !!result.auto
    };
}
