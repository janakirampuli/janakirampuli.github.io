const SLEEP_HELP = 'A regular schedule and an earlier bedtime are the most practical places to start.';

const asleep = {
  what: 'Total time the watch scored as sleep, including naps. Moments awake are not counted.',
  ideal: '7-9 hours for most adults.',
  help: SLEEP_HELP,
};
const deep = {
  what: 'The deepest sleep stage, when the body is hardest to wake. It is linked with physical recovery and mostly happens early in the night.',
  ideal: 'A rough guide is 1-2 hours. Watch readings are estimates.',
  help: 'Protect the first part of the night with a consistent, earlier bedtime.',
};
const rem = {
  what: 'The stage most associated with dreaming, memory and mood. REM periods get longer toward morning, so short nights often cut it first.',
  ideal: 'A rough guide is 1.5-2 hours, or about 20-25% of sleep.',
  help: 'Getting enough total sleep is usually what raises it.',
};
const core = {
  what: "Apple's name for light sleep. It usually makes up the largest share of the night.",
  ideal: 'No fixed target. It is often about half of total sleep.',
};
const awake = {
  what: 'Time awake between falling asleep and waking up. Brief wake-ups are normal, and you may not remember them.',
  ideal: 'A rough guide is under 30 minutes.',
  help: 'Check noise, light, temperature, and late alcohol or caffeine.',
};
const sleepHr = {
  what: 'Your heart rate while asleep. It usually falls well below your daytime rate.',
  ideal: 'A rough guide: under 60 bpm is good and under 50 bpm is often seen in very fit people.',
  help: 'Regular fitness can lower it over time. Hard training can raise it the following night.',
};
const hrv = {
  what: 'How much the time between heartbeats varies. Apple reports it as SDNN, in milliseconds.',
  ideal: 'No universal target, because it varies with age and from person to person. Watch your own trend.',
  help: 'A value well below your usual level can follow poor sleep, illness or hard training.',
};
const resting = {
  what: 'Your heart rate when calm and at rest, estimated by Apple Watch.',
  ideal: '60-100 bpm is the usual adult range. Lower can be normal, especially if you train.',
  help: 'Regular aerobic exercise tends to lower it over time.',
};
const breath = {
  what: 'Breaths per minute, measured while you sleep.',
  ideal: '12-20 breaths per minute is the usual adult range at rest.',
};
const oxygen = {
  what: 'The share of your blood carrying oxygen, estimated from the wrist. Watch fit and movement can affect the reading.',
  ideal: '95-100% is usual for healthy people at sea level.',
  help: 'If readings stay low or you feel breathless, confirm with a proper device or ask a doctor.',
};
const steps = {
  what: 'Steps counted each day.',
  ideal: 'Research finds most of the benefit by about 7,000 a day, with some further benefit beyond that.',
  help: 'Short walks spread through the day add up quickly.',
};
const exercise = {
  what: 'Minutes of brisk activity or more, as counted by Apple Watch.',
  ideal: 'The WHO recommends at least 150 minutes of moderate activity a week, about 21 minutes a day.',
  help: 'Brisk walking counts. It does not all need to happen in one session.',
};
const distribution = (what, ideal) => ({ what, ideal });

const wristTemp = {
  what: 'Skin temperature at the wrist overnight. Your room and bedding can affect it, so it is not a body temperature reading.',
  ideal: 'No fixed target. Compare it with your own usual level.',
};

const INFO = {
  'Time asleep': asleep,
  'Sleep duration': {
    what: 'Time asleep is all sleep that day, including naps. Main sleep span runs from first falling asleep to finally waking in your longest sleep, so it includes wake-ups.',
    ideal: asleep.ideal,
    help: SLEEP_HELP,
  },
  'Bedtime and wake time': {
    what: 'When you first fell asleep and finally woke in your main sleep, as detected by the watch.',
    ideal: 'No fixed target. Keeping the times consistent matters most.',
    help: 'Start with a steady wake time, including on weekends.',
  },
  'Sleep stages': {
    what: 'How each night divides into deep, core and REM sleep, plus time awake. Stages are estimates from the watch, not a sleep lab.',
    ideal: 'Rough guide: deep 1-2 h, REM 1.5-2 h, awake under 30 min.',
    help: 'Look for a pattern over many nights instead of reacting to one.',
  },
  'Sleep stages vs ideal': {
    what: 'Your average for each stage against its rough ideal range. The number on the right is how many nights landed in range.',
    ideal: 'The dot sits inside the green section.',
    help: 'Use Stage trend below to see whether a stage is improving.',
  },
  Deep: deep,
  'Deep sleep': deep,
  REM: rem,
  'REM sleep': rem,
  Core: core,
  Awake: awake,
  'Awake at night': awake,
  'Heart rate during sleep': sleepHr,
  'Sleep heart rate': sleepHr,
  'HRV during sleep': hrv,
  'Sleep HRV': hrv,
  'Sleep heart rate distribution': distribution(
    'How often each sleeping heart rate appeared. A narrow group of bars means steadier nights.',
    sleepHr.ideal,
  ),
  'Sleep HRV distribution': distribution(
    'How often each HRV reading appeared during sleep. Compare it with your own past shape.',
    hrv.ideal,
  ),
  'Breathing rate during sleep': breath,
  'Breathing rate': breath,
  'Heart rate over time': {
    what: 'Daily averages by state. Rest is during sleep, workout is readings marked active (including brisk walking), and awake is everything else.',
    ideal: 'No single target. Lower rest and awake rates over time usually go with better fitness.',
    help: 'Regular aerobic exercise is the main long-term lever.',
  },
  'Awake heart rate distribution': distribution(
    'How often each heart rate appeared while awake and not active.',
    'No fixed target. Compare it with your own past shape.',
  ),
  'Workout heart rate distribution': distribution(
    'How often each heart rate appeared in readings marked active, including workouts and brisk walking.',
    'Depends on your age and the goal of the session.',
  ),
  'Resting heart rate': resting,
  'VO2 max': {
    what: 'An estimate of how much oxygen your body can use during hard effort. It is a common measure of aerobic fitness.',
    ideal: 'Higher is generally better. Typical values depend on age and sex.',
    help: 'Outdoor walks and runs with the watch give Apple what it needs to estimate it.',
  },
  'Sleep regularity': {
    what: 'An estimate of how often you are in the same state, asleep or awake, at the same time on consecutive days. It only uses your main sleep, so wake-ups and naps are not included.',
    ideal: 'Higher is better. There is no agreed target, and 100 means identical sleep times every day.',
    help: 'Keep your bedtime and wake time steady, including on weekends.',
  },
  'Heart rate recovery': {
    what: 'How far your heart rate drops in the first minute after exercise. Apple Watch records it after some workouts.',
    ideal: 'A bigger drop is generally better. Compare it with your own trend.',
    help: 'Regular aerobic exercise tends to improve it over time.',
  },
  'Strength sessions per week': {
    what: 'Workouts logged on the watch as strength or core training. Sessions you do not log are not counted.',
    ideal: 'A common guideline is at least 2 sessions a week.',
    help: 'Start a strength workout on the watch so the session is counted.',
  },
  'Daily steps': steps,
  Steps: steps,
  Calories: {
    what: 'Active calories come from movement. Total adds the energy your body uses at rest. Both are estimates.',
    ideal: 'No universal target. It depends on your body and goals.',
  },
  'Exercise time': exercise,
  Exercise: exercise,
  'Blood oxygen': oxygen,
  'Breathing disturbances': {
    what: 'Signs of disturbed breathing during sleep, detected from small wrist movements. This is not a sleep apnea diagnosis.',
    ideal: 'Apple only labels these as elevated or not elevated, and does not publish a numeric target.',
    help: 'Alcohol and colds can raise them. If you snore loudly or wake unrefreshed, ask a doctor.',
  },
  'Wrist temperature during sleep': wristTemp,
  'Wrist temperature': wristTemp,
  'Bedtime and time asleep': {
    what: 'Each dot is one night, placed by when you fell asleep and how long you slept. The line shows the overall trend.',
    ideal: 'Dots inside the shaded 7-9 h band. A line sloping down means later nights cost you sleep.',
    help: SLEEP_HELP,
  },
  'Bedtime and wake time': {
    what: 'Each dot is one night, placed by when you fell asleep and when you woke up. The line shows the overall trend.',
    ideal: 'If the line is flatter than one hour per hour, your wake time is fixed and a late night shortens your sleep.',
    help: 'If your wake time is fixed, an earlier bedtime is the main way to sleep longer.',
  },
  'Weekend shift': {
    what: 'How much later the middle of your sleep is on Friday and Saturday nights than on Sunday to Thursday nights.',
    ideal: 'Under 1 hour.',
    help: 'Keep weekend bedtimes and wake times within an hour of your weeknight ones.',
  },
  'Weeknight sleep': asleep,
  'Weekend sleep': asleep,
};

export const infoFor = (name) => INFO[name] ?? null;
