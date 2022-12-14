import ChainService, { Chain } from './chain.service';
import { CosmWasmClient as CWClient, SigningCosmWasmClient, CodeDetails, Contract } from '@cosmjs/cosmwasm-stargate';
import { MsgExecuteContractEncodeObject, MsgInstantiateContractEncodeObject } from '@cosmjs/cosmwasm-stargate';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { GasPrice } from '@cosmjs/stargate';
import { OfflineSigner } from '@cosmjs/proto-signing';
import { HttpError } from '~/utils/http-error';
import GithubService from './github.service';
import BuilderService from './builder.service';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

class CosmWasmClient {
  chainService: ChainService;
  githubService: GithubService;
  chain: Chain;
  client: SigningCosmWasmClient;
  constructor(client: SigningCosmWasmClient, chainService: ChainService, chainId: string) {
    this.chainService = chainService;
    this.githubService = new GithubService();
    this.chain = this.chainService.getChainById(chainId);
    this.client = client;
  }

  async getAddress(): Promise<string> {
    // @ts-ignore
    const signer = this.client.signer as OfflineSigner;
    const [{ address }] = await signer.getAccounts();
    return address;
  }

  static async connect(chainId: string): Promise<CosmWasmClient> {
    const chainService = new ChainService();
    const rpc = chainService.getBestRPC(chainId);
    const client = (await CWClient.connect(rpc)) as SigningCosmWasmClient;
    return new CosmWasmClient(client, chainService, chainId);
  }

  static async connectWithSigner(chainId: string): Promise<CosmWasmClient> {
    const chainService = new ChainService();
    const chain = chainService.getChainById(chainId);
    if (!chain.fees?.fee_tokens?.length) throw new HttpError(501);
    const [{ denom }] = chain.fees?.fee_tokens;
    const rpc = chainService.getBestRPC(chainId);
    const wallet = await CosmWasmClient.getWallet(chain.bech32_prefix);
    const client = await SigningCosmWasmClient.connectWithSigner(rpc, wallet, { gasPrice: GasPrice.fromString(`${0.025}${denom}`) });
    return new CosmWasmClient(client, chainService, chainId);
  }

  static async getWallet(bech32Prefix: string): Promise<DirectSecp256k1HdWallet> {
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(process.env.MNEMONIC, {
      prefix: bech32Prefix
    });
    return wallet;
  }

  static buildSchemaFromRepo(code_ref: { repoUrl: string; commitHash: string; repoPath: string }) {
    const cwd = path.join(process.cwd(), 'temp');
    if (!existsSync(cwd)) mkdirSync(cwd);
    GithubService.verifyRepo(code_ref.repoUrl);
    GithubService.cloneRepo(cwd, code_ref);
    BuilderService.buildRepo(cwd, code_ref.repoPath);
    const schema = BuilderService.getSchema(cwd, code_ref.repoPath);
    GithubService.deleteRepo(cwd);
    return schema;
  }

  async getContractsByCodeId(codeId: number): Promise<readonly string[]> {
    return await this.client.getContracts(codeId);
  }

  async getCodeDetails(codeId: number): Promise<CodeDetails> {
    return await this.client.getCodeDetails(codeId);
  }

  async getContractDetails(address: string): Promise<Contract> {
    return await this.client.getContract(address);
  }

  async simulate(address: string, encodeMsg: MsgExecuteContractEncodeObject | MsgInstantiateContractEncodeObject) {
    return await this.client.simulate(address, [encodeMsg], undefined);
  }

  async query(address: string, msg: Record<string, unknown>): Promise<any> {
    return await this.client.queryContractSmart(address, msg);
  }
}

export default CosmWasmClient;
