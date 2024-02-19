import { CortexStep, decision, externalDialog, internalMonologue, mentalQuery } from "socialagi";
import { MentalProcess, useActions, usePerceptions, useSoulMemory } from "soul-engine";
import { Perception } from "soul-engine/soul";
import { DiscordEventData, SoulActionConfig } from "../discord/soulGateway.js";
import { withSoulStoreOrRag } from "./lib/customHooks.js";
import { emojiReaction } from "./lib/emojiReact.js";
import { initializeSoulStore } from "./lib/initialization.js";
import { prompt } from "./lib/prompt.js";
import {
  getDiscordActionFromPerception,
  getLastMemory,
  getMetadataFromPerception,
  getUserDataFromDiscordEvent,
  isRunningInDiscord,
  newMemory,
  random,
} from "./lib/utils.js";
import { defaultEmotion } from "./subprocesses/emotionalSystem.js";

const initialProcess: MentalProcess = async ({ step: initialStep }) => {
  const { log } = useActions();
  const { invokingPerception, pendingPerceptions } = usePerceptions();
  const { userName, discordEvent } = getMetadataFromPerception(invokingPerception);

  if (hasReachedPendingPerceptionsLimit(pendingPerceptions.current)) {
    log("Skipping perception due to pending perceptions limit");
    return initialStep;
  }

  const isMessageBurst = hasMoreMessagesFromSameUser(pendingPerceptions.current, userName);
  if (isMessageBurst) {
    log(`Skipping perception from ${userName} due to message burst`);
    return initialStep;
  }

  await initializeSoulStore();

  let step = rememberUser(initialStep, discordEvent);

  if (shouldWelcomeUser(invokingPerception)) {
    step = await thinkOfWelcomeMessage(step, userName);
  } else {
    const [isTalkingToJulio, nextStep] = await Promise.all([
      isUserTalkingToJulio(step, userName),
      thinkOfReplyMessage(step, userName),
      reactWithEmoji(step, discordEvent),
    ]);

    if (!isTalkingToJulio) {
      log(`Skipping perception from ${userName} because they're talking to someone else`);
      return initialStep;
    }

    step = nextStep;

    const userSentNewMessagesInMeantime = hasMoreMessagesFromSameUser(pendingPerceptions.current, userName);
    if (userSentNewMessagesInMeantime) {
      log(`Skipping perception from ${userName} because they've sent more messages in the meantime`);
      return initialStep;
    }
  }

  return await saySomething(step, userName, discordEvent);
};

function hasReachedPendingPerceptionsLimit(pendingPerceptions: Perception[]) {
  const { log } = useActions();
  log("Total pending perceptions:", pendingPerceptions.length);

  const maximumQueuedPerceptions = 10;
  return pendingPerceptions.length > maximumQueuedPerceptions;
}

function hasMoreMessagesFromSameUser(pendingPerceptions: Perception[], userName: string) {
  const { log } = useActions();

  const countOfPendingPerceptionsBySamePerson = pendingPerceptions.filter((perception) => {
    return getMetadataFromPerception(perception)?.userName === userName;
  }).length;

  log(`Pending perceptions from ${userName}: ${countOfPendingPerceptionsBySamePerson}`);

  return countOfPendingPerceptionsBySamePerson > 0;
}

function rememberUser(step: CortexStep<any>, discordEvent: DiscordEventData | undefined) {
  const { log } = useActions();

  const { userName, userDisplayName } = getUserDataFromDiscordEvent(discordEvent);

  log("Remembering user");
  const userModel = useSoulMemory(userName, `- Display name: "${userDisplayName}"`);
  const userLastMessage = useSoulMemory(userName + "-lastMessage", "");

  let remembered = "";

  if (userModel.current) {
    remembered += userModel.current;
  }

  if (userLastMessage.current) {
    remembered += `\nThe last message Julio sent to ${userName} was: ${userLastMessage.current}`;
  }

  remembered = remembered.trim();

  if (remembered.length > 0) {
    remembered = `Julio remembers this about ${userName}:\n${remembered.trim()}`;
    step = step.withMemory(newMemory(remembered));

    log(remembered);
  } else {
    log(`Julio has no memories involving ${userName} `);
  }

  return step;
}

function shouldWelcomeUser(perception: Perception | undefined | null) {
  const action = getDiscordActionFromPerception(perception);
  const isJoinActionFromDiscord = action === "joined";
  const isSimulatedJoinActionFromDebug = !isRunningInDiscord(perception) && perception?.content === "JOINED";
  const shouldWelcomeUser = isJoinActionFromDiscord || isSimulatedJoinActionFromDebug;
  return shouldWelcomeUser;
}

async function thinkOfWelcomeMessage(step: CortexStep<any>, userName: string) {
  const { log } = useActions();

  log("New member joined the server");
  const thought = await step.compute(
    internalMonologue(`Julio thinks of a short and cool welcome message for ${userName}.`)
  );

  step = step.withMemory(
    newMemory(
      prompt(`
        Julio thought: "${thought} oh and I CANNOT FORGET to mention these SUPER IMPORTANT things:
        - there are 3 levels in the server: welcome area, satoshi street, and collector's corner
        - ${userName} needs to know that the name of the place we are now is "the welcome area"
        - ${userName} should check out satoshi street
        - if ${userName} is a holder, they should go to channel ${soul.env.holderVerifyChannel} so they can join the collector's corner
        - no other channel or area should be mentioned now!!!"
      `)
    )
  );

  return step;
}

async function isUserTalkingToJulio(step: CortexStep<any>, userName: string) {
  const { log } = useActions();

  const messageTarget = await step.compute(
    decision(
      `Julio is the moderator of this channel. Participants sometimes talk amongst themselves without Julio. In this last message sent by ${userName}, guess which person they are probably speaking with.`,
      ["julio", "someone else", "not sure"]
    ),
    {
      model: "quality",
    }
  );

  log(`Julio decided that ${userName} is talking to: "${messageTarget}"`);

  if (messageTarget === "not sure") {
    const chimeIn = random() < 0.5;

    log(`Not sure if ${userName} is talking to Julio, chime in? ${chimeIn ? "yes" : "no"}`);
    return chimeIn;
  }

  return messageTarget === "julio";
}

async function thinkOfReplyMessage(step: CortexStep<any>, userName: string) {
  const { log } = useActions();

  const ragTopics = "Julio, Super Julio World, Julio's Discord Server, or Bitcoin Ordinals";
  const needsRagContextPromise = step.compute(mentalQuery(`${userName} has asked a question about ${ragTopics}`), {
    model: "quality",
  });

  const additionalContextNextStepPromise = thinkOfReplyWithAdditionalContext(step, userName);
  const simpleReplyNextStepPromise = thinkOfSimpleReply(step, userName);

  const needsRagContext = await needsRagContextPromise;
  if (needsRagContext) {
    log("Question needs additional context to be answered");

    step = await additionalContextNextStepPromise;
  } else {
    log("Question can be answered with a simple reply");

    step = await simpleReplyNextStepPromise;
  }

  return step;
}

async function thinkOfReplyWithAdditionalContext(step: CortexStep<any>, userName: string) {
  step = await withSoulStoreOrRag(step);

  step = await step.next(
    internalMonologue(
      `Julio thinks of an answer to ${userName}'s question based on what was just remembered as a relevant memory.`
    ),
    {
      model: "quality",
    }
  );

  return step;
}

async function thinkOfSimpleReply(step: CortexStep<any>, userName: string) {
  const julioEmotions = useSoulMemory("emotionalState", defaultEmotion);

  step = await step.next(
    internalMonologue(`Feeling ${julioEmotions.current.emotion}, Julio thinks of a response to ${userName}.`),
    {
      model: "quality",
    }
  );

  return step;
}

async function reactWithEmoji(step: CortexStep<any>, discordEvent: DiscordEventData | undefined) {
  const { log, dispatch } = useActions();

  if (random() < 0.5) {
    log("Skipping emoji reaction");
    return;
  }

  log("Thinking of an emoji to react with");
  const emoji = await step.compute(emojiReaction());

  const actionConfig: SoulActionConfig = {
    type: "reacts",
    sendAs: "emoji",
  };

  log(`Reacting with ${emoji}`);
  dispatch({
    action: actionConfig.type,
    content: emoji,
    _metadata: {
      discordEvent,
      actionConfig,
    },
  });
}

async function saySomething(step: CortexStep<any>, userName: string, discordEvent?: DiscordEventData) {
  const { log, dispatch } = useActions();

  const maxMessages = 3;
  const avgWordsInMessage = 40;

  const lastThought = getLastMemory(step);
  const lastThoughtWordCount = lastThought?.split(" ").length;
  const thoughtToSpeechRatio = 1.2;
  const targetResponseWordCount = Math.min(lastThoughtWordCount ?? avgWordsInMessage) * thoughtToSpeechRatio;
  const parts = Math.min(Math.ceil(targetResponseWordCount / avgWordsInMessage), maxMessages);

  let fullMessage = "";
  for (let i = 1; i <= parts; i++) {
    const maxWords = avgWordsInMessage + Math.floor(random() * 40) - 20;

    log(`Message ${i}/${parts} with ${maxWords} words max`);
    const message = `Julio speaks part ${i} of ${parts} of what he just thought, using no more than ${maxWords} words.`;
    const { stream, nextStep } = await step.next(externalDialog(message), {
      stream: true,
      model: "quality",
    });

    const actionConfig: SoulActionConfig = {
      type: "says",
      sendAs: i === 1 ? "reply" : "message",
    };

    dispatch({
      action: actionConfig.type,
      content: stream,
      _metadata: {
        discordEvent,
        actionConfig,
      },
    });

    step = await nextStep;
    fullMessage += step.memories.slice(-1)[0].content.toString().split(":")[1]?.trim() + "\n";

    if (i < parts) {
      const hasFinished = await step.compute(mentalQuery("Julio said everything he just thought."), {
        model: "quality",
      });

      if (hasFinished) {
        log("Julio already finished his train of thought.");
        break;
      }
    }
  }

  const userLastMessage = useSoulMemory(userName + "-lastMessage", "");
  userLastMessage.current = fullMessage;

  return step;
}

export default initialProcess;
