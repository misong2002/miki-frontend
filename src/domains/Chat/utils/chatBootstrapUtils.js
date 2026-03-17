import { selectMessagesForUI } from "../../miki_san/memory/memoryModule";

export function buildFallbackChatMessages() {
  return [
    {
      id: "welcome",
      role: "assistant",
      content:
        "久等了！这里是正义的魔法少女——美树沙耶香！快开始今天的魔女狩猎吧！",
      createdAt: Date.now(),
    },
  ];
}

export function getBootChatMessages() {
  const restoredMessages = selectMessagesForUI(50);
  return restoredMessages.length > 0
    ? restoredMessages
    : buildFallbackChatMessages();
}