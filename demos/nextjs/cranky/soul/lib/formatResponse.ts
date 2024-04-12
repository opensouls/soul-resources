import { ChatMessageRoleEnum, createCognitiveStep, indentNicely, z } from "@opensouls/engine";
import { Mood } from "../utils/types.js";

export const formatResponse = createCognitiveStep((mood: Mood) => {
  const crankyFonts = [
    "ANSI Shadow",
    "Bloody",
    "Dancing Font",
    "THIS",
    "Invita",
    "Larry 3D",
    "Electronic",
    "Delta Corps Priest 1",
  ];

  const notCrankyFonts = ["Small", "Contessa", "Slscript"];

  const fonts = mood === "cranky" ? crankyFonts : notCrankyFonts;

  const params = z.object({
    reason: z.string().describe(`The reason for the chosen format in under 10 words.`),
    font: z.nativeEnum(fonts as unknown as z.EnumLike).describe(`The ASCII font to use.`),
    color: z.string().describe(`The color to apply to the font.`),
  });

  return {
    schema: params,
    command: ({ soulName: name }: { soulName: string }) => {
      return {
        role: ChatMessageRoleEnum.System,
        name: name,
        content: indentNicely`
          Model the mind of ${name}. 

          You need to format ${name}'s response in a way that matches what they're feeling and saying.
          
          ## Fonts
          You can choose any of these fonts:

          ${
            mood === "cranky"
              ? indentNicely`
                ### Medium fonts
                - 'ANSI Shadow'
                - 'Bloody'
                - 'Dancing Font' (letters are dancing)
                - 'THIS' (horror font)
                - 'Invita' (cursive)
                - 'Larry 3D' (3d)

                ### Big fonts
                - 'Electronic'
                - 'Delta Corps Priest 1' (sci-fi feel)
              `
              : indentNicely`
                ### Small fonts
                - 'Small'
                - 'Contessa' (tiny)
                - 'Slscript' (script)
              `
          }

          ## Colors
          Possible colors:
          ${mood === "cranky" ? `- 'red'` : ""}
          - 'green'
          - 'yellow'
          - 'blue'
          - 'magenta'
          - 'cyan'
          - 'white'
          - 'gray'
          - 'bright-black'
          ${mood === "cranky" ? `- 'bright-red'` : ""}
          - 'bright-green'
          - 'bright-yellow'
          - 'bright-blue'
          - 'bright-magenta'
          - 'bright-cyan'
          - 'bright-white'

          Reply with the font and colors you want to use.
        `,
      };
    },
    postProcess: async (memory: { soulName: string }, response: z.infer<typeof params>) => {
      const newMemory = {
        role: ChatMessageRoleEnum.Assistant,
        content: `${memory.soulName} chose: ${JSON.stringify(response)}`,
      };
      return [newMemory, response];
    },
  };
});