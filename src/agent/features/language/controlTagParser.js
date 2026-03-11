/**
 * 最小缓存控制符解析器
 *
 * 设计目标：
 * 1. 普通文本尽量直接输出，不做额外缓存
 * 2. 只有看到 < 才进入 tag buffer
 * 3. 一旦 tag 闭合，立刻输出：
 *    - 合法控制符 => events
 *    - 非法标签   => text
 * 4. 兼容两种协议：
 *    <emotion:happy>
 *    <<emotion:happy>>
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

        // 普通文本状态：字符直接输出，只有遇到 < 才开始怀疑是控制符
        if (this.state === "TEXT") {
          if (ch === "<") {
            this.state = "TAG";
            this.tagBuffer = "<";
          } else {
            text += ch;
          }
          continue;
        }

        // TAG 状态：只缓存疑似标签内容
        this.tagBuffer += ch;

        const tag = this.tagBuffer;

        // 兼容单尖括号和双尖括号的闭合
        const isSingleClosed =
          tag.startsWith("<") &&
          !tag.startsWith("<<") &&
          tag.endsWith(">");

        const isDoubleClosed =
          tag.startsWith("<<") &&
          tag.endsWith(">>");

        if (isSingleClosed || isDoubleClosed) {
          // 先尝试匹配双尖括号协议
          let emotionMatch = tag.match(
            /^<<emotion:\s*([a-zA-Z0-9_-]+)\s*>>$/i
          );
          let motionMatch = tag.match(
            /^<<motion:\s*([a-zA-Z0-9_-]+)\s*>>$/i
          );

          // 再尝试单尖括号协议
          if (!emotionMatch) {
            emotionMatch = tag.match(
              /^<emotion:\s*([a-zA-Z0-9_-]+)\s*>$/i
            );
          }
          if (!motionMatch) {
            motionMatch = tag.match(
              /^<motion:\s*([a-zA-Z0-9_-]+)\s*>$/i
            );
          }

          if (emotionMatch) {
            events.push({ type: "emotion", value: emotionMatch[1] });
          } else if (motionMatch) {
            events.push({ type: "motion", value: motionMatch[1] });
          } else {
            // 闭合了但不是合法控制符，原样回吐为普通文本
            text += tag;
          }

          // 一闭合就立刻清空 tagBuffer，回到 TEXT
          this.state = "TEXT";
          this.tagBuffer = "";
          continue;
        }

        // 如果疑似标签太长还没闭合，直接降级为普通文本
        if (this.tagBuffer.length > 128) {
          text += this.tagBuffer;
          this.state = "TEXT";
          this.tagBuffer = "";
        }
      }

      return { text, events };
    },

    flush() {
      let text = "";

      // 流结束时，残余疑似标签按普通文本吐出
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