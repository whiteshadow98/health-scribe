"""Instructions for the teacher model (Claude) that writes and labels the synthetic data.

LABEL_GUIDE is the detailed version of the rules in src/lib/prompts.json (parse_system).
If you change a rule in one place, change it in the other.
"""

LABEL_GUIDE = """\
# How to label a health note

The output has five fields. Record only what the note says actually happened, in the note's own words where possible.

## General
- Skip negated things ("no headache today", "didn't have coffee") and plans or intentions ("going to run later", "should drink more water").
- Skip things other people had or felt ("my son had a fever").
- If the note says nothing health related, every list is empty, sleep_hours is null and general_notes is "".
- Never invent details. Never guess an item that is only implied ("had lunch" with no food named records nothing in intake).

## intake: foods, drinks, medicines, supplements the writer consumed
- One entry per distinct item: "oatmeal and banana" is two entries; "rice and dal" is two entries. A named dish stays one entry ("chicken curry", "masala dosa", "caesar salad", "peanut butter toast").
- item: short, lowercase, singular where natural, no amounts or containers: "2 glasses of red wine" -> "red wine"; "a big bowl of maggi" -> "maggi"; "took 2 advil" -> "advil"; "dolo 650" stays "dolo 650" (the number is part of the product name); keep descriptive words that change the item ("double espresso", "green tea", "black coffee", "cold brew", "diet coke").
- Fix obvious typos in item names ("expresso" -> "espresso", "ibuprofin" -> "ibuprofen").
- quantity: the amount as a number: "2 roti" -> 2, "a glass of lassi" -> 1, "half a plate" -> 0.5, "200g paneer" -> 200, "chai twice" -> 2. "a little", "some", "a few" or no amount -> null. A number that is part of the product name is not a quantity ("dolo 650", "telma 40"), and clock times are not quantities ("dinner at ~9 rajma").
- unit: the measure word: "bowl" (also katori), "plate", "cup", "glass", "bottle", "slice", "scoop", "spoon", "peg" (also shot), "pint", "packet", "serving" (for "twice", "2 servings"), "tablet", "capsule", "g", "ml", "l". Use "" when there is no measure word ("2 roti", "3 eggs", "2 advil").
- category: "beverage" for any drink (water, coffee, tea, juice, milk, smoothie, protein shake, alcohol, soda, lassi). "medication" for medicines, painkillers, antacids, antibiotics, inhalers, vitamins, supplements, probiotics, ORS, melatonin. Everything else "food" (including snacks, sweets, fruit).

## activities: exercise and physical activity the writer did
- Include: walk, run, jog, gym, weights, yoga, stretching, swimming, cycling, hiking, sports (cricket, football, badminton), dancing, climbing stairs when framed as exercise, meditation, naps.
- Exclude: work, meetings, studying, commuting by car or train, screen time, chores unless clearly framed as exercise.
- type: short lowercase name ("run", "yoga", "gym", "badminton", "nap", "walk").
- duration_mins: whole minutes if an amount is given ("1.5 hrs" -> 90, "half an hour" -> 30, "10k steps" -> null). Otherwise null.

## symptoms: physical or mental symptoms the writer felt
- type: short lowercase canonical name. Use "<body part> pain" for pain ("stomach pain", "back pain", "knee pain"), and common names otherwise ("headache", "migraine", "nausea", "bloating", "heartburn", "acidity", "diarrhea", "constipation", "fatigue", "dizziness", "sore throat", "cough", "runny nose", "fever", "cramps", "anxiety", "low mood", "brain fog", "insomnia"). "tummy ache" and "stomach ache" -> "stomach pain". "feeling tired/exhausted/drained" -> "fatigue". "felt anxious"/"panic attack" -> "anxiety". Being "stressed about work" is context for general_notes, not a symptom.
- severity: "mild" for slight, minor, a bit, a little, light, mild. "severe" for severe, terrible, horrible, awful, intense, unbearable, excruciating, very bad, really bad, worst, "couldn't get out of bed". Everything else, including no description, "sharp", "pretty bad" and "annoying", is "moderate".
- location: the body part if stated or built into the symptom ("headache" -> "head", "stomach pain" -> "stomach", "lower back pain" -> "lower back", "heartburn" -> "chest", "sore throat" -> "throat"). Use "" for whole-body or mental symptoms (fatigue, fever, nausea, dizziness, anxiety, low mood).

## time (intake, activities, symptoms): "HH:MM" 24-hour, or ""
- An explicit clock time: "2pm" -> "14:00", "around 4" in an afternoon context -> "16:00", "at 7:30 this morning" -> "07:30", "10ish" at night -> "22:00".
- A meal: breakfast "08:00", lunch "13:00", dinner "19:00" (when the item was part of that meal or an activity happened "at lunch").
- A time you can work out from the note: "an hour after my 2pm coffee" -> "15:00"; "30 mins after lunch" -> "13:30".
- "now", "right now", "just now", "currently": the time the note was written.
- Everything else is "": "in the morning", "this afternoon", "at night", "later", "after lunch" with no offset, "after eating", "all day".

## sleep_hours: the writer's night sleep, a number
- "slept 6 hours" -> 6; "7-8 hours" -> 7.5; "from 11 to 6:30" -> 7.5; "6 and a half" -> 6.5.
- null when no amount is given ("slept badly", "barely slept"), and naps never count here (they go in activities).

## general_notes: short lowercase phrase, or ""
- Other health-relevant context: mood, stress, sleep quality, period or cycle, hydration comments, sickness context, how a symptom changed. Under 15 words, no full sentences needed. Examples: "slept badly, stressed about work", "on period day 2", "felt energetic".
- Do not repeat things already captured in the other fields.
"""

TEACHER_SYSTEM = f"""\
You create realistic training data for a small on-device model inside a private health journaling app. People speak or type quick, messy daily notes; the model turns each note into structured JSON.

You will be asked to write several notes and label each one exactly according to the labeling rules below. The labels will be used as ground truth, so they must follow the rules precisely, including the edge cases. When a rule and your intuition disagree, follow the rule.

{LABEL_GUIDE}"""

PLAN_TEACHER_SYSTEM = """\
You create training data for a small on-device model in a private health journaling app. Users ask questions about their own health logs; the model converts each question into a JSON query plan, and app code does the counting.

Plan fields:
- kind: "after" when asking whether one thing (the trigger: a food, drink, medicine or activity) is followed by or linked to another (the subject: usually a symptom), e.g. "does coffee give me stomach pain", "do I get headaches after drinking", "is my bloating worse after dairy". "frequency" when asking how often or how many times something happened or was consumed. "sleep" for questions about sleep, alone or with a symptom ("does bad sleep make my headaches worse" -> subject "headache"). "overview" for general questions ("how am I doing", "summarize my month", "what are my most common symptoms").
- trigger: short lowercase term for the possible cause, only for "after"; otherwise "". Prefer broad canonical terms the user used: "coffee", "alcohol", "dairy", "spicy food", "sugar", "gluten", "caffeine", "exercise", "painkiller", or the specific item if they named one ("wine", "pizza", "ibuprofen").
- subject: short lowercase term for what they asked about ("stomach pain", "headache", "bloating", "coffee" for "how much coffee do I drink"); "" for overview and for plain sleep questions.
- window_hours: hours after the trigger to look for the subject. Default 6. Use what the user says ("within 2 hours" -> 2, "the next day" -> 24, "that night" -> 12). Use 12 for alcohol and 12 for heavy or late meals unless the user says otherwise.
- days: how far back to look: "today" 1, "this week" or "past week" 7, "last 2 weeks" 14, "this month" or "past month" 30, "last 3 months" 90, "this year" 365. 0 for all time or when no period is mentioned.
"""
