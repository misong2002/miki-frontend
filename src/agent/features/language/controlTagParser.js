/**
 * 全程增量控制符状态机
 *
 * 识别：
 *   <emotion:happy>
 *   <motion:001>
 *
 * 设计原则：
 * 1. 按字符流式处理，可跨 chunk 保持状态
 * 2. 只有完整闭合且合法的标签才触发控制事件
 * 3. 半截标签先缓存，不显示
 * 4. 非法标签/普通尖括号内容按正文输出
 */
export function createControlStreamParser() {
  return {
    state: "TEXT", // TEXT | TAG
    tagBuffer: "",

    push(chunk) {
      let text = "";
      const events = [];

      for (let i = 0; i < chunk.length; i += 1) {
        const ch = chunk[i];

        if (this.state === "TEXT") {
          if (ch === "<") {
            this.state = "TAG";
            this.tagBuffer = "<";
          } else {
            text += ch;
          }
          continue;
        }

        this.tagBuffer += ch;

        if (ch === ">") {
          const tag = this.tagBuffer;
          const emotionMatch = tag.match(/^<emotion:([a-zA-Z0-9_-]+)>$/);
          const motionMatch = tag.match(/^<motion:([a-zA-Z0-9_-]+)>$/);

          if (emotionMatch) {
            events.push({ type: "emotion", value: emotionMatch[1] });
          } else if (motionMatch) {
            events.push({ type: "motion", value: motionMatch[1] });
          } else {
            text += tag;
          }

          this.state = "TEXT";
          this.tagBuffer = "";
          continue;
        }

        if (this.tagBuffer.length > 64) {
          text += this.tagBuffer;
          this.state = "TEXT";
          this.tagBuffer = "";
        }
      }

      return { text, events };
    },

    flush() {
      let text = "";

      if (this.state === "TAG" && this.tagBuffer) {
        text = this.tagBuffer;
      }

      this.state = "TEXT";
      this.tagBuffer = "";

      return { text, events: [] };
    },

    reset() {
      this.state = "TEXT";
      this.tagBuffer = "";
    },
  };
}