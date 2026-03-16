export function createCharacterRuntimeBridge({ emotionEngine }) {
  let speechOn = false;
  let lastExpressionId = null;
  let lastMotionId = null;

  return {
    apply(command) {
//       console.log(
//   "[CharacterCommand]",
//   command.type,
//   command.value ?? ""
// );

      switch (command.type) {
        case "SET_EMOTION": {
          const expressionId = String(command.value);
          if (lastExpressionId === expressionId) return;

          lastExpressionId = expressionId;
          emotionEngine.setExpressionById(expressionId, {
            source: "orchestrator",
          });
          break;
        }

        case "PLAY_MOTION": {
          const motionId = String(command.value);
          if (lastMotionId === motionId) return;

          lastMotionId = motionId;
          emotionEngine.playMotionById(motionId, {
            source: "orchestrator",
          });
          break;
        }

        case "SET_SPEECH": {
          if (!speechOn) {
            speechOn = true;
            emotionEngine.setSpeaking(true, {
              source: "orchestrator",
            });
          }
          break;
        }

        case "STOP_SPEECH": {
          if (speechOn) {
            speechOn = false;
            emotionEngine.setSpeaking(false, {
              source: "orchestrator",
            });
          }
          break;
        }

        case "INTERRUPT": {
          speechOn = false;
          emotionEngine.interrupt({
            source: "orchestrator",
          });
          break;
        }

        case "RESET": {
          speechOn = false;
          lastExpressionId = null;
          lastMotionId = null;
          emotionEngine.reset();
          break;
        }

        default:
          break;
      }
    },
  };
}