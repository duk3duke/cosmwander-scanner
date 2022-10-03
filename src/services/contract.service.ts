import { ContractModel } from '../models';
import CodeService from './code.service';
import CosmWasmClient from './cosmwasm.service';
import GithubService from './github.service';
import { CosmWasmClient as CWClient, SigningCosmWasmClient, CodeDetails, Contract } from '@cosmjs/cosmwasm-stargate';
import ChainService from './chain.service';

class ContractService {
  codeService: CodeService;
  constructor () {
    this.codeService = new CodeService();
  }

  async getContractDetails (chainId: string, address: string): Promise<Contract> {
    // const chainService = new ChainService();
    // const rpc = chainService.getBestRPC(chainId);
    // const client = (await CWClient.connect(rpc)) as SigningCosmWasmClient;
    // const cosmwasmService = new CosmWasmClient(client, chainService, chainId);
    // const contractInfo = await cosmwasmService.getContractDetails(address);
    await this.createContractDetails(chainId, address);
    const contractDetails = await ContractModel.findOne({ address, chain_id: chainId });
    console.log({ address, contractDetails });
    if (contractDetails) return contractDetails;
    return await this.getContractDetails(chainId, address);
  }

  async getContractSchema (chainId: string, address: string): Promise<unknown> {
    const contract = await this.getContractDetails(chainId, address);
    const codeSchema = await this.codeService.getCodeSchema(chainId, contract.code_id);
    return codeSchema.definition;
  }

  async createContractDetails (chainId: string, address: string): Promise<void> {
    const client = await CosmWasmClient.connect(chainId);
    console.log({ address, chainId });
    const { codeId: code_id, creator, admin, label, ibcPortId } = await client.getContractDetails(address);
    console.log({ code_id });
    const contract = new ContractModel({ address, code_id, chain_id: chainId, creator, admin, label, ibcPortId });
    await contract.save();
  }
}

export default ContractService;
