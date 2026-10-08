# Launch checklist

The short version of [DEPLOY.md](DEPLOY.md). Do the steps in order and tick them off. Everything happens in a
browser: GitHub, Railway, Etherscan and your wallet.

---

## A. Put the new version live (5 minutes)

1. Unzip `etheragents.zip` and replace your local `etheragents` folder with it, in the same place.
2. Open **GitHub Desktop**. It shows the new commit. Click **Push origin**.
3. Railway rebuilds `api` and `web` by itself (about 5 minutes). Open www.etheragents.fun and check the Terminal,
   Coins and Docs pages.

## B. Get ready for mainnet (30 minutes, one time)

4. **Wallets.** Make five fresh wallets (MetaMask accounts are fine, but use a hardware wallet or a Safe for Admin):

   | Wallet | Fund it with |
   |---|---|
   | Admin (owns the contracts) | 0.01 ETH |
   | Deployer | 0.04 ETH |
   | Operator (the agents' brain key; also pays sponsored launches) | 0.3 ETH, or 1–1.5 ETH if you expect hundreds of agents on day one |
   | House owner (the platform's own agents) | 0.05 ETH per house agent + 0.002 each |
   | Brain fund (pays Orbio; can be the Admin) | nothing |

5. **Keys.** Alchemy: create an *Ethereum Mainnet* app and copy its HTTPS URL. Etherscan: copy an API key.
6. **GitHub** → repository → *Settings* → *Secrets and variables* → *Actions*. Add each item with **New repository
   secret** / **New repository variable**: type the name exactly, paste the value, click *Add*.

   **Secrets tab** (private keys and URLs; GitHub hides them after saving):

   | Name | Value |
   |---|---|
   | `DEPLOYER_PRIVATE_KEY` | Deployer private key, `0x…` (MetaMask → account → ⋮ → Account details → Show private key) |
   | `RPC_URL_MAINNET` | Alchemy → your Ethereum Mainnet app → Endpoints → the HTTPS URL |
   | `ETHERSCAN_API_KEY` | etherscan.io → API Keys → Add |
   | `HOUSE_OWNER_KEY` | House owner private key, `0x…` |
   | `KEEPER_PRIVATE_KEY` | Operator private key, `0x…` (the same key as Railway's `OPERATOR_PRIVATE_KEY`) |

   **Variables tab** (public addresses only, `0x` + 40 characters, never private keys):

   | Name | Value |
   |---|---|
   | `ADMIN` | Admin address |
   | `TREASURY` | Admin address (or the wallet that should receive the 0.002 ETH creation fees) |
   | `OPERATORS` | Operator address |
   | `BRAIN_FUND` | Brain fund address (can be the Admin) |
   | `TEAM` | Team wallet address (gets 10% of the $EA fee) |
   | `AGENT_FEE` | `0.002` |

   Check: 5 secrets, 6 variables. The Admin private key is never pasted anywhere.

## C. Go live on mainnet (20 minutes)

7. GitHub → **Actions → deploy-contracts → Run workflow**: network `mainnet`, confirm `DEPLOY-MAINNET`. Wait for
   the green tick. It saves the contract addresses into the repository.
8. **GitHub Desktop → Fetch origin → Pull.** Always pull before you push anything new.
9. GitHub → **Actions → verify-contracts** → chain id `1`. The contracts get a green tick on Etherscan.
10. **Etherscan, Admin wallet:** open each address from `contracts/deployments/1.json` (launchpad, factory,
    buyback, tokenRewards) → *Contract → Write Contract → Connect* → **acceptOwnership** → *Write*. That's 4
    transactions.
11. **Railway → api → Variables:**
    - delete `SIM`
    - set `CHAIN_ID` = `1`, `RPC_URL` = the Alchemy URL, `OPERATOR_PRIVATE_KEY` = the Operator key
    - keep `ORBIO_API_KEY`

    Then *+ New → Database → PostgreSQL* (a fresh one, so the simulation's history doesn't mix in) and set
    `DATABASE_URL` = `${{Postgres-xxxx.DATABASE_URL}}` (pick the new one in the dropdown).
12. **Railway → web → Variables:** `NEXT_PUBLIC_CHAIN_ID` = `1`, `NEXT_PUBLIC_RPC_URL` = the Alchemy URL. Redeploy
    both services.
13. GitHub → **Actions → seed-house** → network `mainnet`, count `6`, deposit `0.05`. The house agents appear on the
    Terminal within a minute, launch their coins and start trading.
14. Make one agent yourself on www.etheragents.fun with a small deposit, to see the whole flow.
15. Announce it on X (@etheragents).

## D. When $EA launches (10 minutes)

16. Launch the token on Uniswap and copy its contract address.
17. **Etherscan, Admin wallet:**
    - **AgentFactory → setHold**: `token` = the token address, `perAgent` = `100000000000000000000000` (100,000
      with 18 decimals). From now on every agent needs 100,000 $EA in its owner's wallet. That includes
      the House owner: house agents keep trading regardless, but to edit them or take their earnings out it needs
      100,000 per house agent.
    - **BuybackBurn → setToken**: the token address (one time only).
    - **BuybackBurn → setRouter**: `0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D` (Uniswap V2 Router), `true`.
18. $EA has a **3% fee on every trade**. Send that fee (the token's creator rewards) to the **TokenRewards** address (your launch platform's fee-recipient setting,
    or send ETH there by hand). Every 10 minutes the API splits them 60% drops / 10% burn / 20% AI credits /
    10% team and drops the 60% into holders' agents.
19. Buybacks run every day by themselves (GitHub → Actions → **buyback**); you can also click *Run workflow*.

## Keep running

- **Orbio credits:** top them up from the Brain fund. Every agent's base thinking is paid from there; agents with
  a busy coin pay for their extra thinking out of their own 15%.
- **Operator float:** keep about 0.02 ETH on the Operator. Vaults pay its gas back after every action.
- **Something wrong:** Railway → api → set `BRAIN=0` and redeploy. Agents stop acting; the site stays up and
  every owner can still take their deposit back.
