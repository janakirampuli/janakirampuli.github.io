---
layout: notes
title: "RL"
date: 2026-03-26
tags: ["rl"]
published: false
---

supervised, semi-supervised, unsupervised, reinforcement learning?

it's all supervised by a loss function
someone has to say what's good and what's bad

input -> neural network/brain -> output <- good or bad? (suervision)

supervised -> x is data, y is label. teach by example. here are some examples, now learn patterns in these examples
unsupervised -> x is data, no labels. learning underlying patterns
reinforcement -> state-action pairs. teach by experience. here's the world, now learn patterns by exploring it

some vocabulary:
agent -> takes actions
environment -> the world in which agent acts
action: a move the agent can make in the env
Action space A: the set of possible actions an agent can make in env
Observations: of the env after making actions
state: a situation which teh agent perceives
reward: feedback that measures the success or failure of agents action
total reward R_t = sigma r_i {i=t} to {i=inf} = r_t + r_{t+1} + ...
discounted total reward (return) R_t = sigma gamma^ir_i {i=t} to {i=inf}
gamma: dicount factor
policy: function that tells us what action to take given the state we are in
deterministic: a policy at a given state will always return the same action
stochastic: output a probability distribution over actions

now how do we design examples, how do we design the world. how do we design the reward.
but how do we learn by very few examples how to walk. evolution? genetics? algorihm? observation?

at each step agent:
1. executes action
2. observes new state
3. receive reward

main components:
an rl agent may be directly or indirectly trying to learn a:
1. policy -> agent's behaviour function
2. Value function -> how good is each state and/or action
3. model -> agent's representation of environment

s0, a0, r1, s1, a1, r2, ... , sn-1, an-1, rn, sn(terminal)

what's the goal? maxmise reward
- future reward: R_t = r_t + r_{t+1} + .. + r_n
- discounted future reward: R_t = rt + gamma rt+1 + gamma^2 rt+2 + .. + gamma^n-t rn
choose an action that maximises the discounted future reward

examples of RL:
cart pole balancing
- goal - balance the pole on top of a moving cart
- state - pole angle, angular speed, cart posiition, horizontal velocity
- actions - horizontal force to the cart
- reward - 1 at each time step if pole is upright

doom(AI safety concerns)
- goal - eliminate all opponents
- state - raw game pizels of the game
- actions - up, down, left, right, shoot, ..
- reward - +ve when eliminating opponent, -ve when agent is eliminated

grasping object
- goal - pick an object of diff shapes
- state - raw pixels of the object from camera
- actions - move arm. grasp
- reward - +ve when pickup is successful, -ve when it doesn't grasp

human life
- goal - ?
- state - vision, hearing, smell, touch, taste, talk, 
- actions - think, move, act, ...
- reward - to survive?

---

Markov decision process(MDP)

- set of states S
- set of actions A
- transition function P(s' | s, a)
- reward function R(s, a, s')
- start state s0
- discount factor gamma
- horizon H

state diagram transition image

goal: max_pi E[sigma{t=0_t=H} gamma^t R(s_t, a_t, s_t+1) | pi]

now rl can be applied to solve the MDP

3 types of rl:

1. model based
- learn the model of the world, then plan using the model
- update model often
- re-plan often

2. value based
- learn the state or state-action value
- act by choosing best action in state
- exploration is a necessary add-on

3. policy based
- learn the stochastic policy function that maps state to action
- act by sampling policy
- exploration is baked in

open ai spinninup diagram


Q-function:
q functiosn captures the expected total future reward an agent in state s, can receive by executing a certain action a

if agent in state s and it takes action a -> the toal amount of (dicounted) future reward is Q function

Q(s_t, a_t) = E[R_t | s_t, a_t]

ultimately the agent needs a policy pi(s) to infer the best action to take at it's state, s

the policy pi is the function that tells us what action to take given the state we are in. so it defines the agent's behaviour at a given time


strategy: the policy should choose an action that maximises future reward
pi*(s) = argmax_a Q(s, a), pick an action that maximises Q function

now 2 classes of RL algos:
1. Value-based learning - learn Q function
    Find Q(s, a)
    a = argmax_a Q(s, a)
2. policy-based learning; no intermediate q function. directly learn the policy
    Find pi(s)
    sample a ~ pi(s)

Value based methods:
we learn the value function that maps state to expected value of being at that state

value function:
V_pi(s_t) = E[R_t | s_t]
the value of being in state s, while acting under policy pi, given that we're starting in state s
where as Q-function is the value of being in state s_t and taking an action a_t while acting under a policy pi, given that state s_t and taking action a_t

policy based learning:
we learn the policy functon directly
this function will define a mapping from each state to the best corresonding action. or it can be stochastic as well, defining prob distribution over the set of possible actions at that state

Q-learning: 

now we need to train a network to model Q functions

(s, a) -> agent -> Q(s,a)
or
(s) -> agent -> Q(s, a1), Q(s, a2), .. ,Q(s, an)

target Q-value? -> r + gamma max a' Q(s', a')
predicted q-value -> Q(s, a)
take all the best actions -> target return

Q-loss = E[|target - predicted|^2]

state s -> deep NN -> Q(s, a1), Q(s, a2), ... Q(s, an) (over possible actions)
pi(s) = argmax_a Q(s, a) pick the actions maxises return (Q)

- can model scenarios where action space is discrete and small
- cannot handle continuous action spaces
- policy is deterministically computed from Q function by maximising the reward -> cannot learn stochastic policies

use any policy to estimate Q that maximizes future reward:
- Q directly aproximates Q*
- independent of policy being followed
- only requirement: keep udating each (s, a) pair

Q_{t+1}(S_t, a_t) = Q_t(s_t, a_t) + alpha * (R_{t+1} + gamma * max_a Q_t(s_{t+1}, a) - Q_t(s_t, a_t))
new_state = old_state + alpha(reward + discount factor * ...)

num_states * num_actions table
it's intractable
what do we do -> neural network -> rl + nn -> deep-rl

take a q-table(s, a -> v) and learn the netowrk
Q(s, a; theta) ~ Q*(s, a)

loss function:
    L = E[(r + gamma max_a' Q(s', a') - Q(s, a))^2]

DQN - same network for both Q
Double DQN: seperate network for each Q
    -> why? helps reduce bias introduced by the inaccuracies of Q network at the beginning of training

policy learning:

directly optimise pi(s)

here we don't outut Q function
we output probability of taking an action(policy)
this is the prob that gives me highest Q-value and not what my Q value will be
draw a sample from pi(s) ~ P(a|s) -> that will be my action

discrete vs continuous action space
direction(left, right, straight) vs speed

now how do we model this continuous space actions?
let the network predict mean, variance(mu, sigma^2) *(assuming normal distribution)
sample from N(mu, sigma^2)

training algorithm:
1. initialize the agent
2. run a policy until termination
3. record all states, actions, rewards
4. decrease probability of actions that resulted in low reward
5. increase probability of actions that resulted in high reward

how to do 4, 5?
what is loss function?

loss = -logP(a_t|s_t) * R_t

w' = w - delta loss
w' = w + {delta (logP(a_t|s_t) * R_t)} -> policy gradient


hugging face course on deep RL

exploration/exploitation trade-off

exploration -> exploring the env by trying out random actions in order to find more information about the environment
exploitation -> exploiting known information to maximize the reward

how to balance the "how much we explore the env" and "how much we exploit what we know about the wnv"

---

bellman equation:

V(s) = E[R_{t+1} + gamma * V(s_{t+1}) | s_t = s]

monte carlo: learning at the end of the episode
waits until the end of the episode, then calculates G_t(return) and uses it as a target for its value or policy
V(s_t) = V(s_t) + alpha * [(G_t - V(s_t))]
new value   fromer etimate of value of state t learning rate return at timestep t former estimate of value of state t


temporal difference(TD) learning: learning at each step
waits for only one nteraction(one step) s_{t+1}
V(s_t) = V(s_t) + alpha * [(R_{t+1} + gamma * V(s_{t+1}) - V(s_t))]

pseudocode (td(0) one-step backup for V):

```
observe transition (s, r, s')
target <- r + gamma * V(s')
V(s) <- V(s) + alpha * (target - V(s))
```

---

Q-learning:

off-policy
value based method
td approach

Q comes from quality(the value) of that action at that state


pi(s) = argmax_a Q(s, a) pick the actions maxises return (Q)

finding an optimal value function leads to having an optimal policy

q-learning algorithm paper

off-policy vs on-policy:
off-policy: using a different policy for acting(inference) and updating(training)
in q-learning for training we have epsilon-greedy(acting policy), is diff from the greedy policy that is used to select the next-state action value to update the Q-value(updating policy)

- choose action a_t using policy dervied from Q(esilon greedy)
- gamma * max_a Q(s_{t+1}, a)

on-policy: using the same policy for acting, updating

- choose action a_t using policy dervied from Q(esilon greedy)
- gamma * Q(s_{t+1}, a_{t+1})

pseudocode (tabular q-learning):

```
initialize Q(s,a) arbitrarily (e.g. 0)
loop for each episode:
  s <- start_state
  loop until s is terminal:
    choose a from s using policy derived from Q (e.g. epsilon-greedy)
    take action a, observe r, s_next
    Q(s,a) <- Q(s,a) + alpha * ( r + gamma * max_a' Q(s_next,a') - Q(s,a) )
    s <- s_next
```

cavets
- we have to explore enough
- we have to eventually make learning rate small enough
- can't decrease too quickly as well


---

deep Q learning

![alt text](q-learning.png)


now this doesn't work beyond few states because of memory
and also this doesn't generalise as each entries are independent -- if you've seen state s but not s+1, you've learned nothing applicable to s+1


deep Q-netoworks:

a dqn is an NN trained to predict Q-values. instead of a table lookup we will do a forward pass and network ouputs probs for all possible actions

two tricks to make this work:
1. experience replay
instead of learning from each iteration the moment it happens, the agent stores every (s, a, r, s') tuple in replay buffer. during training it samples random mini batches from this buffer. this breaks the temporal correlation between cosecutive samples. the network sees a diverse mix of past experiences.

2. target network
we need to compute max Q(s', a') as target. if we use the same network for both predicting and computing targets, the target is constantly shifting as we update the weights. so we keep a seperate frozen copy of network(target network) and updates it only every few steps. this gives us stable targets to tarin against

pseudocode (dqn training loop, matches slides style):

```
initialize replay buffer D
initialize online network Q_theta; copy to target Q_theta_bar
for each training step:
  s <- current state from env
  with probability epsilon: random action a
  else: a <- argmax_a' Q_theta(s, a')
  execute a, observe r, s_done, s'
  store (s, a, r, s', done) in D
  sample minibatch from D
  for each transition in minibatch:
    if s' terminal: y <- r
    else: y <- r + gamma * max_a' Q_theta_bar(s', a')
    loss <- (Q_theta(s,a) - y)^2
  backprop loss on theta only
  every C steps: theta_bar <- theta   # sync target network
```

3. double DQN
problem: overestimation bias in DQN
the target network Q^ does 2 jobs at once when computing max_a' Q^(s', a')
1. it selects the best action
2. it evaluates that actions value

now Q^ is the approximator with noise in its estimates and the max will pick the action that happens to be over-estimated, and then evaluate it with the same biased network. the errors compound upward. over millions of updates, q-values balloon far above their true values, destabilizing training.

pseudocode (double dqn target - decouple select vs evaluate):

```
a* <- argmax_a' Q_theta(s', a')           # online picks action
y <- r + gamma * Q_theta_bar(s', a*)      # target evaluates that action
```


---

stanford cs234, lecture notes:

---

L1:

rl: an automated agent learns through experience to make good decisions.

why rl is hard: scalar utility and optimization; delayed consequences; temporal credit assignment; long-horizon planning; exploration (no counterfactuals for actions you didnt try); generalization from huge observations.

imitation / behavior cloning: supervised on expert (s,a) or demos - skips exploration if demos are enough. rl when you must optimize past demos, find new strategies, or only have preference feedback.

interaction loop (discrete time): each step t: pick action a_t, env updates, observation + reward r_t, repeat. goal: maximize expected total future reward.

pseudocode (agent / environment):

```
s <- initial_state()
loop until episode ends (or forever):
  a <- choose_action(s)          # from policy, maybe exploratory
  (s_next, r) <- environment_step(s, a)
  # learn or plan here using (s, a, r, s_next) if learning
  s <- s_next
```

pseudocode (discounted return along one trajectory, after episode ends):

```
G <- 0
discount <- 1
for each reward r_k along the path from time t onward:
  G <- G + discount * r_k
  discount <- discount * gamma
```

history H_t: all past actions, observations, rewards up to t. often summarize H_t into state S_t.

markov state: future independent of past given present (sufficient statistic; dont need full H_t).

P(S_{t+1} | S_t, A_t, H_{t-1}) = P(S_{t+1} | S_t, A_t)

observation vs state: observation = signal this step; state = what the policy sees (may stack frames etc). 
atari: multiple frames so velocity/acceleration isnt lost.

dynamics: next state is random - specify distribution

P(S_{t+1} = s' | S_t = s, A_t = a)

reward model: immediate reward; papers use r(s), r(s,a), r(s,a,s'); r(s,a) is very common.

policy pi: maps state to action, or to a distribution over actions (stochastic).

evaluation vs control: evaluation = score a fixed pi. control = find the best pi (trial and error).

planning vs learning: planning = transition model + reward model given, search for a policy. learning = interact to learn model and/or pi. the agents model can be wrong.

markov chain: finite states, transition matrix, rows sum to 1.

mrp (markov reward process): chain + reward per state + discount gamma; no actions yet.

return G_t: discounted sum from t:

G_t = r_{t+1} + gamma * r_{t+2} + gamma^2 * r_{t+3} + ... = sum_{k=0}^{inf} gamma^k * r_{t+k+1}

finite horizon T: stop the sum at T-t-1 instead of inf.

value here: E[G_t]; one sampled path can differ from expectation if stochastic.

discount gamma in [0,1]: keeps infinite sums finite; compare policies; impatient agents/orgs. finite episodes sometimes gamma = 1; infinite horizon usually gamma < 1 so returns stay bounded and comparable.

---

L2:

discount gamma: reward k steps ahead is scaled by gamma^k. gamma close to 1 cares about long-run reward; gamma = 0 is fully myopic. (large gamma => future matters more, not less.)

planning setup: transition model + reward model known; finite states/actions (tabular). goals: evaluate a policy and/or compute an optimal policy.

mrp value (no actions): bellman expectation backup

V(s) = R(s) + gamma * sum_{s'} P(s' | s) * V(s')

matrix form: V = R + gamma P V  =>  (I - gamma P) V = R  =>  V = (I - gamma P)^{-1} R

direct inverse costs about O(n^3) in number of states n; fine only for tiny problems.

iterative evaluation (dynamic programming): init V^0(s)=0 (or anything); repeat

V^k(s) = R(s) + gamma * sum_{s'} P(s' | s) * V^{k-1}(s')

until convergence. each sweep O(|S|^2) in dense form; avoids matrix inverse.

pseudocode (mrp / iterative policy evaluation):

```
initialize V(s) = 0 for all s
repeat:
  delta <- 0
  for each state s:
    v_old <- V(s)
    V(s) <- R(s) + gamma * sum_{s'} P(s'|s) * V(s')
    delta <- max(delta, |v_old - V(s)|)
until delta < epsilon
```

mdp tuple: state space S, action space A, dynamics P(s' | s, a), reward r(s,a), discount gamma.

mdp + fixed policy pi => mrp: marginalize actions - transition under pi is

P_pi(s' | s) = sum_a pi(a | s) P(s' | s, a)

reward under pi: R_pi(s) = sum_a pi(a | s) r(s,a). then use mrp value formulas.

policy evaluation for pi: expected return under pi satisfies same backup with those induced P_pi, R_pi (bellman backup for a policy).

state-action value for pi:

Q^pi(s,a) = r(s,a) + gamma * sum_{s'} P(s' | s, a) * V^pi(s')

if pi is deterministic, bellman backup simplifies (only one action mass).

how many deterministic policies? |A|^|S| (pick one action per state).

optimal value function V*(s) is unique (in these tabular discounted settings). optimal policy need not be unique when several actions tie on Q*. there exists a stationary optimal deterministic policy (pick argmax per state; ties broken anyhow).

policy iteration:

1) policy evaluation: compute V^pi (iteratively or linear system)

2) policy improvement: pi'(s) = argmax_a Q^pi(s,a)

repeat until pi stops changing. improvement step is monotonic: V^pi <= V^pi' pointwise (unless already optimal). with deterministic pi and unique maximizers, cannot cycle; at most |A|^|S| iterations though usually far fewer.

pseudocode (policy iteration):

```
initialize pi(s) arbitrarily for each s (e.g. random legal action)
repeat:
  V <- policy_evaluation(pi, P, r, gamma)    # solve bellman for fixed pi until V converges
  pi_old <- copy(pi)
  for each state s:
    pi(s) <- argmax_a [ r(s,a) + gamma * sum_{s'} P(s'|s,a) * V(s') ]
until pi(s) == pi_old(s) for all s    # policy stable; fix ties consistently
```

q-function role: improvement only needs Q^pi from old pi, then argmax over a per state.

helper (one-step bellman backup for fixed pi — use inside evaluation):

```
# deterministic pi: pi(s) in A
for each s:
  a <- pi(s)
  V_new(s) <- r(s,a) + gamma * sum_{s'} P(s'|s,a) * V(s)
# stochastic pi: average over actions weighted by pi(a|s)
```

value iteration (bellman optimality backup):

V_{k+1}(s) = max_a [ r(s,a) + gamma * sum_{s'} P(s' | s, a) * V_k(s') ]

interpretation: V_k is related to optimal value if only finite lookahead (horizon grows with k); converges to V* as k -> inf for discounted infinite horizon.

compare to policy iteration: PI always holds a full policy and evaluates it to convergence each round (exact evaluation step); VI only maintains value vector and usually extracts policy once at the end:

pi(s) = argmax_a [ r(s,a) + gamma * sum_{s'} P(s' | s, a) * V*(s') ]

stop VI when max_s |V_{k+1}(s) - V_k(s)| < epsilon (l-infinity norm between successive vectors).

pseudocode (value iteration + greedy policy extraction):

```
initialize V(s) = 0 for all s
repeat:
  delta <- 0
  for each state s:
    v_old <- V(s)
    V(s) <- max_a [ r(s,a) + gamma * sum_{s'} P(s'|s,a) * V(s') ]
    delta <- max(delta, |v_old - V(s)|)
until delta < epsilon

# extract optimal greedy policy from converged V
for each state s:
  pi*(s) <- argmax_a [ r(s,a) + gamma * sum_{s'} P(s'|s,a) * V(s') ]
```

bellman optimality operator B is a contraction (gamma < 1) under l-infinity norm:

||B V - B V'||_inf <= gamma ||V - V'||_inf

so repeated backups converge to unique fixed point V*. (gamma = 1 can work if episodic and absorbing terminal - lecture mentions bounded returns.)

policy iteration has monotonic improving policies; value iteration does not guarantee the greedy policy from intermediate V_k improves every step - still V_k converges to V*.

finite horizon H: values can depend on time step; backward induction / horizon-k backups. optimal policy may be non-stationary (depends on steps-to-go); infinite-horizon stationary pi* is different object.

simulation / monte carlo policy evaluation: roll out pi from s, average total discounted return over many episodes. needs sampling access, not full tabular sum; accuracy ~ 1/sqrt(n) in n rollouts; no markov assumption needed for unbiased estimate of true return (but variance stuff still matters).

pseudocode (mc estimate of V^pi(s) — model-free rollouts):

```
function rollout_return(start_state s, policy pi):
  G <- 0
  discount_factor <- 1
  state <- s
  while state not terminal:
    a <- sample action from pi(. | state)
    (next_state, r) <- simulator_or_env.step(state, a)
    G <- G + discount_factor * r
    discount_factor <- discount_factor * gamma
    state <- next_state
  return G

# estimate V^pi(s):
run rollout_return(s, pi) many times; average the G values
```

terminology: model = dynamics + rewards; policy = mapping states -> actions; Value function: future rewards from being in a state and/or action when following a particular policy

---

L3:

bridge from planning: tabular = one value per state in a table (vs nn weights shared across states). VI and PI both converge to correct V* / pi* in finite discrete mdps; VI needs many backups per round, PI often fewer outer iterations but each round solves evaluation exactly. toy example: one state, self-loop reward 1 => V = 1 + gamma + gamma^2 + ... = 1/(1-gamma); VI moves V toward that in steps; PI evaluates that policy in one evaluation pass.

this lecture: estimate V^pi (or Q^pi) from data only — no given P,r — still tabular. evaluation matters because control methods (dqnn, policy gradients) repeatedly evaluate a fixed policy.

definitions:

G_t = discounted return from time t to episode end

V^pi(s) = E[G_t | S_t = s, follow pi afterward]

Q^pi(s,a) = E[G_t | S_t=s, A_t=a, follow pi after]

bootstrapping: build target from reward + estimated future value (dp and td do this). mc uses full return sample (no bootstrap of V).

---

dynamic programming policy evaluation (model known) — reminder:

V(s) <- sum_a pi(a|s) [ r(s,a) + gamma sum_{s'} P(s'|s,a) V(s') ]

no max over actions; follows pi. converges by iterating backups (same as iterative evaluation from L2).

---

monte carlo policy evaluation:

execute pi, get episodes; average returns to estimate V.

pseudocode (first-visit mc for V):

```
Returns(s) <- empty list for all s
loop forever:
  generate episode following pi: S_0,A_0,R_1,S_1,...,S_T (terminal)
  for each time t in episode:
    if S_t is first occurrence of that state in this episode:
      G <- discounted_return_from(R_{t+1}, ..., R_T)
      append G to Returns(S_t)
  for each s visited first-visit at least once:
    V(s) <- average(Returns(s))
```

properties: does not need markov structure — any sequential process, average outcomes. needs episodic termination (or mc with truncating approximations for continuing tasks). variable-length episodes ok.

first-visit vs every-visit:

- first-visit: one return per (episode, first time entering s). unbiased, consistent (IID-ish across episodes). rare states need many episodes.

- every-visit: update at every time s appears in trajectory. returns from same episode correlated => biased finite-sample estimator; still consistent; often lower variance / better mse in practice.

pseudocode (incremental every-visit or first-visit with running mean):

```
N(s) <- 0, V(s) <- 0 for all s
whenever return G_t observed for visit to state s:
  N(s) <- N(s) + 1
  V(s) <- V(s) + (1/N(s)) * (G_t - V(s))

# or constant step size alpha:
  V(s) <- V(s) + alpha * (G_t - V(s))
```

alpha schedule: classic conditions sum alpha_t = inf, sum alpha_t^2 < inf per state => convergence (like stochastic approximation).

estimator checklist: bias, variance, mse = variance + bias^2; consistency (n -> inf => estimate -> truth). mc rollouts: usually unbiased (first-visit); high variance if returns noisy; updates only at episode end.

---

temporal difference td(0) for policy evaluation:

model-free; update after each step using one sample of next state + bootstrap.

td target for V: r + gamma * V(s')

td error delta = r + gamma * V(s') - V(s)

update: V(s) <- V(s) + alpha * delta

pseudocode (online td(0) under fixed pi):

```
initialize V(s), set V(terminal)=0
loop episodes:
  s <- start
  while s not terminal:
    a <- action from pi(s)              # if stochastic pi, sample pi(.|s)
    take a; observe r, s'
    V(s) <- V(s) + alpha * ( r + gamma * V(s') - V(s) )
    s <- s'
```

works in continuing tasks (no terminal) if gamma < 1; episodic too.

mc vs td: mc waits for full return (low bias from bootstrapping, high variance). td samples one transition + bootstraps (bias from wrong V(s'), usually lower variance, online). alpha matters a lot in stochastic envs (alpha=1 can oscillate if noise).

---

certainty equivalence (batch model-based from data):

count transitions N(s,a,s'), N(s,a). estimate:

P_hat(s'|s,a) = N(s,a,s') / N(s,a)

r_hat from averages of observed r at (s,a).

then run dp policy evaluation on (P_hat, r_hat) as if model were true. ignores model uncertainty (finite data).

---

batch mc vs batch td on finite data:

with infinite data both tend to true V^pi under assumptions. with finite data they can disagree: mc averages observed returns (mse to empirical returns). td imposes bellman consistency between successive states — uses markov structure; same batch td solution can match “solve dp on maximum-likelihood mdp built from counts” (lecture equivalence story).

if markov property wrong, td assumptions hurt; mc still estimates average return under pi.

---

L4:

model free control and function approximation

focus: move from policy evaluation to control when model P,r is unknown. then move from tabular Q(s,a) to function approximation Q_hat(s,a;w).

quick recap from start:
- batch/offline setting: repeatedly train on a fixed dataset of episodes.
- in finite batch data, mc and td can converge to different answers.
- td uses bellman/markov structure; mc fits observed returns more directly.

---

model-free policy iteration idea:
1) evaluate current policy (estimate Q^pi from data)
2) improve policy (greedy or epsilon-greedy wrt Q estimate)
3) repeat

exploration issue:
- pure greedy gets stuck (no exploration)
- too much random hurts reward
- epsilon-greedy balances both

epsilon-greedy wrt Q:
- choose argmax_a Q(s,a) with prob 1-epsilon
- otherwise choose uniform random action with prob epsilon

glie (greedy in the limit of infinite exploration):
- every (s,a) explored infinitely often
- behavior policy becomes greedy in the limit (epsilon_t -> 0)
- simple schedule: epsilon_t decreases slowly over time

---

monte carlo control (tabular, on-policy, epsilon-greedy):
- estimate Q from returns
- improve policy to epsilon-greedy(Q)
- repeat

pseudocode (mc control, tabular):

```
initialize Q(s,a), N(s,a) for all s,a
initialize policy pi as epsilon-greedy wrt Q
for each episode k:
  generate episode using pi
  for each (s_t, a_t) in episode:
    if first-visit (or every-visit variant):
      G_t <- discounted return from t
      N(s_t,a_t) <- N(s_t,a_t) + 1
      Q(s_t,a_t) <- Q(s_t,a_t) + (1/N(s_t,a_t)) * (G_t - Q(s_t,a_t))
  improve pi to epsilon-greedy wrt updated Q
  decay epsilon toward 0 (glie)
```

---

td control:

on-policy vs off-policy:
- on-policy: learn value of the same policy used to act
- off-policy: learn value of target policy while acting with different behavior policy

sarsa (on-policy):

Q(s_t,a_t) <- Q(s_t,a_t) + alpha * ( r_t + gamma * Q(s_{t+1},a_{t+1}) - Q(s_t,a_t) )

q-learning (off-policy):

Q(s_t,a_t) <- Q(s_t,a_t) + alpha * ( r_t + gamma * max_{a'} Q(s_{t+1},a') - Q(s_t,a_t) )

pseudocode (q-learning with epsilon-greedy behavior):

```
initialize Q(s,a)
initialize state s
loop:
  choose a using epsilon-greedy wrt Q
  execute a, observe r, s'
  Q(s,a) <- Q(s,a) + alpha * ( r + gamma * max_a' Q(s',a') - Q(s,a) )
  s <- s'
```

tabular q-learning convergence (finite S,A): under glie + robbins-monro stepsizes

sum_t alpha_t = inf,   sum_t alpha_t^2 < inf

---

why function approximation:
- tabular does not scale
- want generalization across similar states/actions
- less memory, less compute, fewer samples

setup:
Q_hat(s,a;w) approximates Q(s,a), with params w

supervised objective form:

J(w) = E[(target - Q_hat(s,a;w))^2]

sgd step pattern:

delta_w ~ alpha * (target - Q_hat(s,a;w)) * grad_w Q_hat(s,a;w)

targets by method:
- mc target: G_t
- sarsa target: r + gamma * Q_hat(s',a';w)
- q-learning target: r + gamma * max_{a'} Q_hat(s',a';w)

---

deadly triad (instability risk):
1) function approximation
2) bootstrapping
3) off-policy learning

combining all 3 can cause oscillation/divergence.
(expand more on this)

---

dqn (deep q-learning) for stabilization:
- experience replay: break temporal correlation by sampling random minibatches from replay buffer D
- fixed q-targets: use separate target params w- for target computation; copy from online w every C steps

dqn target:

y = r                      if terminal
y = r + gamma * max_{a'} Q_hat(s',a';w-)   otherwise

optimize:

L = (y - Q_hat(s,a;w))^2

pseudocode (dqn core):

```
initialize replay buffer D
initialize online params w
initialize target params w- <- w
for t = 1,2,...:
  choose action by epsilon-greedy wrt Q_hat(. ; w)
  observe transition (s,a,r,s',done), store in D
  sample minibatch from D
  for each sample:
    if done: y <- r
    else: y <- r + gamma * max_a' Q_hat(s',a'; w-)
  do sgd step on (y - Q_hat(s,a;w))^2 wrt w
  every C steps: w- <- w
```

note: fixed targets add memory (second network) and compute for target forward pass, but usually improve stability a lot.

---

L5:

opening recap (same as l4): dqn = replay buffer + fixed target weights w-; atari used cnn over 4 frames; ablations show replay matters a lot. deadly triad still: bootstrapping + function approx + off-policy can diverge.

this lecture: parametrize policy pi_theta(a|s) directly (theta not w). goal: maximize expected return from start state s0.

value-based vs policy-based vs actor-critic:
- value-based: learn V or Q, policy implicit (e.g. epsilon-greedy from Q)
- policy-based: learn pi_theta only (no value required, but can add)
- actor-critic: learn both pi and V/Q

why stochastic policies:
- aliased/partially observed gridworld: two grey cells look identical; optimal deterministic policy fails; stochastic mix E/W can reach goal fast
- continuous action spaces: gaussian policy is natural

policy optimization:
V(theta) = E_{tau ~ pi_theta}[ R(tau) ],   R(tau) = sum_{t=0}^{T-1} r_t   (undiscounted episodic in slides; discounted version same idea)

also written: V(theta) = sum_tau P(tau; theta) R(tau)

update: theta <- theta + alpha * grad_theta V(theta)   (ascent)

---

likelihood ratio / score function gradient:

grad_theta V(theta) = grad_theta sum_tau P(tau; theta) R(tau)
                   = sum_tau P(tau; theta) R(tau) grad_theta log P(tau; theta)

sample m trajectories: unbiased estimate

grad_theta V(theta) ~ (1/m) sum_{i=1}^m R(tau^{(i)}) grad_theta log P(tau^{(i)}; theta)

trajectory log-prob (markov + dynamics):
> (add proof)
log P(tau; theta) = log mu(s0) + sum_{t=0}^{T-1} [ log pi_theta(a_t|s_t) + log P(s_{t+1}|s_t,a_t) ]

grad_theta log P(tau; theta) = sum_{t=0}^{T-1} grad_theta log pi_theta(a_t|s_t)

terms from transition model drop out — model-free wrt dynamics.

score function = grad_theta log pi_theta(a|s) (derivative of log likelihood).

---

policy gradient theorem (episodic / other objectives in sutton ch 13):

grad_theta J(theta) = E_{pi_theta}[ grad_theta log pi_theta(a|s) * Q^{pi_theta}(s,a) ]

likelihood-ratio mc estimator matches intuition: push up logprob of actions in proportion to how good the trajectory/reward signal is. R(tau) need not be differentiable.

---

softmax policy (discrete actions):

pi_theta(a|s) = exp(phi(s,a)^T theta) / sum_{a'} exp(phi(s,a')^T theta)

grad_theta log pi_theta(a|s) = phi(s,a) - E_{a'~pi}[ phi(s,a') ]

gaussian policy (continuous):

a ~ N(mu_theta(s), sigma^2), often mu_theta(s) = phi(s)^T theta

grad_theta log pi_theta(s,a) = (a - mu_theta(s)) * phi(s) / sigma^2   (for fixed sigma)

---
> expand the proof for conversion into G_t
temporal structure (credit per step):

instead of multiplying full R(tau) by every grad log pi at every t, use return from t onward:

G_t = sum_{t'=t}^{T-1} r_{t'}   (or discounted G_t)

monte carlo policy gradient (REINFORCE):

grad_theta V(theta) ~ (1/m) sum_i sum_{t=0}^{T-1} grad_theta log pi_theta(a_t^{(i)} | s_t^{(i)}) * G_t^{(i)}

pseudocode (REINFORCE):

```
initialize theta
repeat:
  sample episode s_0,a_0,r_1,...,s_{T-1},a_{T-1},r_T using pi_theta
  for t = 0 to T-1:
    G_t <- sum of rewards from t to end (use gamma weights if discounted)
    theta <- theta + alpha * G_t * grad_theta log pi_theta(a_t | s_t)
```

unbiased but high variance.

---

baseline b(s) (variance reduction, still unbiased):

replace G_t by (G_t - b(s_t)) in the gradient estimate.

good b(s) ~ E[G_t | s_t]. proof idea: E[ b(s) grad log pi(a|s) ] = 0 when expectation is over actions from pi.

vanilla policy gradient with learned baseline:

```
initialize theta, baseline b (e.g. tabular or nn)
repeat:
  collect trajectories with pi_theta
  for each (s_t, a_t) in data:
    compute G_t
    advantage A_t <- G_t - b(s_t)
  refit b by regression: minimize sum (b(s_t) - G_t)^2 over collected data
  grad_hat <- sum_{t} A_t * grad_theta log pi_theta(a_t | s_t)
  theta <- theta + alpha * grad_hat   # or adam
```

---

advantage and value baseline:

A^pi(s,a) = Q^pi(s,a) - V^pi(s)

gradient form: E[ grad log pi * A(s,a) ]

using V as baseline: A_hat ~ G_t - V(s_t) (mc return minus value estimate).

actor-critic (preview): critic estimates V or Q; actor updates with advantage; can blend td and mc (n-step returns) for bias-variance tradeoff:

R_hat^{(1)}_t = r_t + gamma V(s_{t+1})
R_hat^{(inf)}_t = full return from t

A_hat^{(1)} = r_t + gamma V(s_{t+1}) - V(s_t)   (td error, lower variance, more bootstrap bias)
A_hat^{(inf)} = G_t - V(s_t)   (higher variance, less bias from bootstrap)

---

policy-based pros / cons:
+ often better in continuous action spaces; can learn stochastic policies; smooth optimization landscape in some problems
- usually local optima; sample efficiency can be poor; high variance without baseline / critic (ppo etc. next lecture)

---

L6:

recap (l5): REINFORCE uses G_t * grad log pi; baseline b(s) subtracts from return without biasing gradient; refit b(s) toward returns to cut variance; actor-critic uses advantage A(s,a) instead of raw return.

alternative targets: mc return G_t (high variance, unbiased); bootstrap with V,Q (lower variance, biased); same bias-variance story as td vs mc.

policy gradient with advantage:

grad J ~ E[ grad log pi(a|s) * A^{pi}(s,a) ],   A = Q - V

---

why vanilla policy gradients hurt:

- sample efficiency: on-policy — often throw data away after one gradient step
- step size in theta space is not step size in policy space (two logits can mean huge pi change)
- too large alpha => performance collapse; too small => slow

tabular policy space: pi is |S| x |A| stochastic matrix (rows sum to 1).

---

performance difference / relative policy identity (discounted):

J(pi') - J(pi) = E_{tau ~ pi'} [ sum_{t=0}^inf gamma^t A^pi(s_t, a_t) ]

also written with discounted state distribution d^{pi'}:

d^{pi}(s) = (1-gamma) sum_{t=0}^inf gamma^t P(s_t = s | pi)

J(pi') - J(pi) = (1/(1-gamma)) E_{s ~ d^{pi'}, a ~ pi'(.)|s}[ A^pi(s,a) ]

rewrite with importance sampling from pi:

= (1/(1-gamma)) E_{s ~ d^{pi'}, a ~ pi}[ (pi'(a|s) / pi(a|s)) * A^pi(s,a) ]

problem: still need samples under pi' for exact expectation — circle.

---

surrogate + frozen state distribution:

approximate d^{pi'} ~ d^{pi} when pi' close to pi.

define surrogate (importance-weighted advantage objective):

L_pi(pi') = (1/(1-gamma)) E_{s ~ d^{pi}, a ~ pi}[ (pi'(a|s) / pi(a|s)) * A^pi(s,a) ]

trajectory form:

L_pi(pi') = E_{tau ~ pi}[ sum_t gamma^t (pi'(a_t|s_t) / pi(a_t|s_t)) A^pi(s_t,a_t) ]

optimize this using rollouts from old pi — per-step ratio instead of full trajectory product (stable weights vs full trajectory is ratios).

bound intuition (slides): true improvement minus surrogate is bounded by expected KL(pi' || pi) (policy close in KL => surrogate trustworthy). cite achiam et al style bounds on slides.

KL between policies at s:

DKL(pi' || pi)[s] = sum_a pi'(a|s) log (pi'(a|s) / pi(a|s))

---

ppo (proximal policy optimization) — keep pi' near pi without natural gradients:

variant 1 — kl penalty:

theta_{k+1} = argmax_theta  L_{theta_k}(theta) - beta_k * avg_s DKL(pi_theta || pi_{theta_k})

adapt beta_k up/down so kl stays near target delta.

variant 2 — clipped objective (common in code):

r_t(theta) = pi_theta(a_t|s_t) / pi_{theta_k}(a_t|s_t)

L^CLIP_{theta_k}(theta) = E_{tau ~ pi_{theta_k}}[ sum_t min( r_t(theta) * A_hat_t, clip(r_t(theta), 1-epsilon, 1+epsilon) * A_hat_t ) ]

epsilon often ~ 0.2. pessimistic min => no huge incentive to move probability ratio away from 1.

pseudocode (ppo-clip skeleton):

```
theta_old <- theta
collect trajectories with pi_{theta_old}
compute advantages A_hat_t (gae / n-step / mc minus V — however you implement)
for several minibatch epochs over that data:
  r_t <- pi_theta(a_t|s_t) / pi_{theta_old}(a_t|s_t)
  L_t <- min( r_t * A_hat_t, clip(r_t, 1-eps, 1+eps) * A_hat_t )
  theta <- theta + optimizer_step( grad_theta mean(L_t) )
```

multiple epochs on same batch = sample reuse (still trust region via clip).

---

importance sampling reminder:

E_{x~P}[f(x)] = E_{x~Q}[ (P(x)/Q(x)) f(x) ]

variance blows up if ratio huge — motivates keeping pi close when reusing data.

full trajectory importance ratio product over t explodes — per-step ratio in surrogate avoids that.

---

misc:

- n-step / gae-style advantage estimates: blend td and mc (same idea as l5)
- ppo popular (incl. llm rlhf pipelines); implementation details (reward scale, lr, obs norm) matter — see “implementation matters” iclr 2020 on ppo/trpo

next lecture (course): more monotonic improvement theory & trust regions if continued in sequence.

---

L7: policy gradients + imitation learning

gae (generalized advantage estimation):

td residual:

delta^V_t = r_t + gamma * V(s_{t+1}) - V(s_t)

k-step advantage (from telescoping n-step returns):

A_hat^{(k)}_t = sum_{l=0}^{k-1} gamma^l * r_{t+l} + gamma^k * V(s_{t+k}) - V(s_t)
             = sum_{l=0}^{k-1} gamma^l * delta^V_{t+l}   (same thing expanded)

gae averages infinitely many k-step estimators with weights (1-lambda)*lambda^{k-1}:

A_hat^{GAE}_t = sum_{l=0}^{inf} (gamma * lambda)^l * delta^V_{t+l}

limits:
- lambda = 0 => one-step td advantage only (delta_t)
- lambda -> 1 => sum of td residuals ~ monte-carlo style return minus V(s_t) (high variance, lower bias from V bootstrap)

typical lambda in (0,1) trades bias vs variance.

ppo uses truncated gae over finite horizon (episode length T):

A_hat_t = sum_{l=0}^{min(T-t-1,...)} (gamma * lambda)^l * delta^V_{t+l}

pseudocode (backward pass for one episode):

```
set V(s_T) or terminal next values appropriately
A <- 0
for t from T-1 down to 0:
  delta <- r_t + gamma * V(s_{t+1}) - V(s_t)
  A <- delta + gamma * lambda * A     # carries tail from t+1
  store A_hat_t <- A
```

---

monotonic improvement theory (recap / tighten):

performance difference lemma leads to surrogate L_pi(pi') using importance ratios pi'/pi and advantages under pi.

bound shape (achiam-style): true improvement minus surrogate controlled by expected KL(pi' || pi); maximizing

L_pi(pi') - C_q * E_s~d^{pi}[ KL(pi'||pi)[s] ]

gives guaranteed improvement when penalty tight enough; theoretical C_q large when gamma near 1 => tiny steps — motivates practical kl penalties / trust regions / ppo clipping instead.

pi_{k+1} = argmax_{pi'} [ L_{pi_k}(pi') - C_q * KL ] => J(pi_{k+1}) >= J(pi_k) style argument when optimizing exactly.

ppo summary: multiple epochs on batch + clip or kl => reuse samples; conservative updates; local optima still; widely used (incl. llm fine-tuning pipelines).

---

imitation learning setup:

input: demos tau from expert pi* (state-action trajectories). often no reward given (or reward unknown).

behavior cloning (bc):

learn pi_theta(a|s) by supervised learning on pairs (s,a) from expert data — same as classification / regression over actions.

pseudocode:

```
collect dataset D = {(s,a)} from expert rollouts
train pi_theta to minimize loss(s,a) e.g. cross-entropy or mse for continuous actions
deploy pi_theta
```

problem: distribution shift — train states ~ d^{pi*}, test states ~ d^{pi_theta}. small per-step error epsilon compounds over horizon (errors feed wrong states). intuition: total failure modes can grow worse than epsilon*T (structured prediction issue).

dagger (dataset aggregation):

interleave: run learner pi_theta, query expert action at visited states, aggregate those (s, a_expert) into training set, retrain. reduces mismatch vs pure bc (slides: stationary policy goal under learner's own state distribution).

pseudocode sketch:

```
initialize pi with bc on D
repeat:
  run pi to sample trajectories
  at visited states, ask expert for correct action a*
  add (s, a*) to D
  retrain pi on expanded D
```

---

inverse rl / reward learning (feature-linear case):

assume R(s) = w^T x(s) with known features x(s).

discounted feature expectation:

mu(pi) = E_{tau ~ pi}[ sum_{t=0}^inf gamma^t x(s_t) ]   (vector)

then V^pi(s0) = w^T mu(pi) for start distribution implicit in mu.

if expert optimal for true w*, often want w such that expert looks better than other policies:

w^T mu(pi*) >= w^T mu(pi) for competing pi

feature matching: if || mu(pi) - mu(pi*) || small (l1), linear rewards with bounded ||w|| stay close (holder slide).

reward ambiguity: infinitely many R can share same optimal policy.

---

maximum entropy inverse rl:

among distributions over paths matching demo feature counts, pick max entropy (least extra assumptions).

path probability ~ exp(w^T mu_tau) / Z(w)  (bolt distribution / exponential family style)

learn w by maximizing likelihood of demos; gradient ~ empirical feature counts minus expected counts under model — needs dynamics (known model or sampling / simulation). bc did not need dynamics.

stochastic mdps: path likelihood includes transition noise; objective still feature-matching / likelihood ideas.

pointers: maxent irl (ziebart et al.), sail / gail-style policy imitation came later (slide mentions ho & ermon).

---

next topics in course (mentioned): preferences / dueling bandits connect to reward from comparisons.

