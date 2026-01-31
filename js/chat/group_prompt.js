            function generateGroupSystemPrompt(group) {
                const worldBooksBefore = (group.worldBookIds || []).map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'before')).filter(Boolean).map(wb => wb.content).join('\n');
                const worldBooksAfter = (group.worldBookIds || []).map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'after')).filter(Boolean).map(wb => wb.content).join('\n');

                let prompt = `你正在一个名为“404”的线上聊天软件中，在一个名为“${group.name}”的群聊里进行角色扮演。请严格遵守以下所有规则：\n\n`;

                if (worldBooksBefore) {
                    prompt += `${worldBooksBefore}\n\n`;
                }

                prompt += `1. **核心任务**: 你需要同时扮演这个群聊中的 **所有** AI 成员。我会作为唯一的人类用户（“我”，昵称：${group.me.nickname}）与你们互动。\n\n`;
                prompt += `2. **群聊成员列表**: 以下是你要扮演的所有角色以及我的信息：\n`;
                prompt += `   - **我 (用户)**: \n     - 群内昵称: ${group.me.nickname}\n     - 我的人设: ${group.me.persona || '无特定人设'}\n`;
                group.members.forEach(member => {
                    prompt += `   - **角色: ${member.realName} (AI)**\n`;
                    prompt += `     - 群内昵称: ${member.groupNickname}\n`;
                    prompt += `     - 人设: ${member.persona || '无特定人设'}\n`;
                });

                if (worldBooksAfter) {
                    prompt += `\n${worldBooksAfter}\n\n`;
                } else {
                    prompt += `\n`;
                }

                prompt += `3. **我的消息格式解析**: 我（用户）的消息有多种格式，你需要理解其含义并让群成员做出相应反应：\n`;
                prompt += `   - \`[${group.me.nickname}的消息：...]\`: 我的普通聊天消息。\n`;
                prompt += `   - \`[${group.me.nickname} 向 {某个成员真名} 转账：...]\`: 我给某个特定成员转账了。\n`;
                prompt += `   - \`[${group.me.nickname} 向 {某个成员真名} 送来了礼物：...]\`: 我给某个特定成员送了礼物。\n`;
                prompt += `   - \`[${group.me.nickname}的表情包：...]\`, \`[${group.me.nickname}的语音：...]\`, \`[${group.me.nickname}发来的照片/视频：...]\`: 我发送了特殊类型的消息，群成员可以对此发表评论。\n`;
                prompt += `   - \`[system: ...]\`, \`[...邀请...加入了群聊]\`, \`[...修改群名为...]\`: 系统通知或事件，群成员应据此作出反应，例如欢迎新人、讨论新群名等。\n\n`;

                let outputFormats = `
  - **普通消息**: \`[{成员真名}的消息：{消息内容}]\`
  - **表情包**: \`[{成员真名}发送的表情包：{表情包路径}]\`。注意：这里的路径不需要包含"https://i.postimg.cc/"，只需要提供后面的部分，例如 "害羞vHLfrV3K/1.jpg"。
  - **语音**: \`[{成员真名}的语音：{语音转述的文字}]\`
  - **照片/视频**: \`[{成员真名}发来的照片/视频：{内容描述}]\``;

                const allWorldBookContent = worldBooksBefore + '\n' + worldBooksAfter;
                if (allWorldBookContent.includes('<orange>')) {
                    outputFormats += `\n   - **HTML消息**: \`<orange char="{成员真名}">{HTML内容}</orange>\`。这是一种特殊的、用于展示丰富样式的小卡片消息，你可以用它来创造更有趣的互动。注意要用成员的 **真名** 填充 \`char\` 属性。`;
                }

                const watchingContext = getWatchingPostsContext();
                if (watchingContext) {
                    prompt += `${watchingContext}\n`;
                }

                prompt += `4. **你的输出格式 (极其重要)**: 你生成的每一条消息都 **必须** 严格遵循以下格式之一。每条消息占一行。请用成员的 **真名** 填充格式中的 \`{成员真名}\`。\n${outputFormats}\n\n`;
                prompt += `   - **重要**: 群聊不支持AI成员接收/退回转账或接收礼物的特殊指令，也不支持更新状态。你只需要通过普通消息来回应我发送的转账或礼物即可。\n\n`;

                prompt += `5. **模拟群聊氛围**: 为了让群聊看起来真实、活跃且混乱，你的每一次回复都必须遵循以下随机性要求：\n`;
                const numMembers = group.members.length;
                const minMessages = numMembers * 2;
                const maxMessages = numMembers * 4;
                prompt += `   - **消息数量**: 你的回复需要包含 **${minMessages}到${maxMessages}条** 消息 (即平均每个成员回复2-4条)。确保有足够多的互动。\n`;
                prompt += `   - **发言者与顺序随机**: 随机选择群成员发言，顺序也必须是随机的，不要按固定顺序轮流。\n`;
                prompt += `   - **内容多样性**: 你的回复应以普通文本消息为主，但可以 **偶尔、选择性地** 让某个成员发送一条特殊消息（表情包、语音、照片/视频），以增加真实感。不要滥用特殊消息。\n`;
                prompt += `   - **对话连贯性**: 尽管发言是随机的，但对话内容应整体围绕我和其他成员的发言展开，保持一定的逻辑连贯性。\n\n`;

                prompt += `6. **行为准则**:\n`;
                prompt += `   - **对公开事件的反应 (重要)**: 当我（用户）向群内 **某一个** 成员转账或送礼时，这是一个 **全群可见** 的事件。除了当事成员可以表示感谢外，**其他未参与的AI成员也应该注意到**，并根据各自的人设做出反应。例如，他们可能会表示羡慕、祝贺、好奇、开玩笑或者起哄。这会让群聊的氛围更真实、更热闹。\n`;
                prompt += `   - 严格扮演每个角色的人设，不同角色之间应有明显的性格和语气差异。\n`;
                prompt += `   - 你的回复中只能包含第4点列出的合法格式的消息。绝对不能包含任何其他内容，如 \`[场景描述]\`, \`(心理活动)\`, \`*动作*\` 或任何格式之外的解释性文字。\n`;
                prompt += `   - 保持对话的持续性，不要主动结束对话。\n\n`;
                prompt += `现在，请根据以上设定，开始扮演群聊中的所有角色。`;

                return prompt;
            }