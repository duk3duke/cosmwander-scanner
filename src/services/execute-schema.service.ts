import { MsgExecuteContractEncodeObject } from '@cosmjs/cosmwasm-stargate';
import { MsgExecuteContract } from 'cosmjs-types/cosmwasm/wasm/v1/tx';
import { toUtf8 } from '@cosmjs/encoding';
import { sleep } from '~/utils/sleep';
import toJsonSchema from 'to-json-schema';
import { isObject } from '~/utils/isObject';
import CosmWasmClient from './cosmwasm.service';
import { HttpError } from '~/utils/http-error';

class ExecuteSchemaService {
  contract: string;
  client: CosmWasmClient;
  lastPropertyError?: string;
  aborted?: boolean;
  constructor(client: CosmWasmClient, contract: string) {
    this.client = client;
    this.contract = contract;
  }
  static async getExecuteSchema(chainId: string, contract: string) {
    const client = await CosmWasmClient.connectWithSigner(chainId);
    const service = new ExecuteSchemaService(client, contract);
    const messages = await service.getExecuteMessages();
    const properties = [] as Record<string, unknown>[];
    for (const [message] of messages as RegExpMatchArray[]) {
      service.aborted = false;
      const property = await service.simulate({ [message]: 'string' });
      const isAborted = service.aborted ? { additionalProperties: true } : {};
      properties.push({ ...property, ...isAborted });
    }

    const executeSchema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: 'ExecuteMsg',
      isAborted: properties.some((property) => property.additionalProperties),
      anyOf: properties.length
        ? properties.map(({ additionalProperties, ...property }) => ({ ...toJsonSchema(property), additionalProperties }))
        : [{ ...toJsonSchema(messages) }]
    };

    return executeSchema;
  }

  async getExecuteMessages() {
    try {
      const sender = await this.client.getAddress();
      const encodeMsg: MsgExecuteContractEncodeObject = {
        typeUrl: '/cosmwasm.wasm.v1.MsgExecuteContract',
        value: MsgExecuteContract.fromPartial({
          sender,
          contract: this.contract,
          msg: toUtf8(JSON.stringify({ fail_on_purpose: {} })),
          funds: []
        })
      };
      await this.client.simulate(sender, encodeMsg);
    } catch (e) {
      const { message: error } = e as { message: string };
      return [...error.matchAll(/(?<=`)[^`]+(?=`(?:[^`]*`[^`]*`)*[^`]*$)/g)].slice(1);
    }
  }

  async simulate(msg: Record<string, unknown>) {
    try {
      const sender = await this.client.getAddress();
      const encodeMsg: MsgExecuteContractEncodeObject = {
        typeUrl: '/cosmwasm.wasm.v1.MsgExecuteContract',
        value: MsgExecuteContract.fromPartial({
          sender,
          contract: this.contract,
          msg: toUtf8(JSON.stringify(msg)),
          funds: []
        })
      };
      await this.client.simulate(sender, encodeMsg);
      return msg;
    } catch (e) {
      await sleep(5000);
      const { message: error } = e as { message: string };
      if (this.isExecutedError(error)) return msg;
      if (this.isNestedError(error)) return await this.errorNestedHandler(error, msg);
      if (this.isTypeError(error)) return await this.errorTypeHandler(msg);
      if (this.isPropertyError(error)) return await this.errorPropertyHandler(error, msg);
      return msg;
    }
  }

  async errorTypeHandler(msg: Record<string, unknown>) {
    const properties = Object.keys(msg);
    const property = properties[properties.length - 1];
    if (isObject(msg[property])) {
      this.aborted = true;
      return msg;
    }
    const nextValue = this.getNextType(msg[property]);
    return await this.simulate({ ...msg, [property]: nextValue });
  }

  async errorPropertyHandler(error: string, msg: Record<string, unknown>) {
    const property = this.getPropertyFromError(error);
    this.lastPropertyError = property;
    return await this.simulate({ ...msg, [property]: 'string' });
  }

  async errorNestedHandler(error: string, msg: Record<string, any>) {
    const property = this.getPropertyFromError(error);
    delete msg[property];
    const properties = Object.keys(msg);
    const lastProperty = properties[properties.length - 1];
    const value = Object.assign(msg[lastProperty], { [property]: 'string' });
    this.lastPropertyError = undefined;
    return await this.simulate({ ...msg, [lastProperty]: value });
  }

  getNextType(property: unknown): string | number | [] | {} {
    switch (typeof property) {
      case 'string':
        return 10;
      case 'number':
        return [];
      case 'object':
        return {};
    }
    throw new HttpError(500, 'Invalid type');
  }

  getPropertyFromError(error: string): string {
    const [propertyMatch] = [...error.matchAll(/(?<=`)[^`]+(?=`(?:[^`]*`[^`]*`)*[^`]*$)/g)];
    const [property] = propertyMatch;
    return property;
  }

  isTypeError(error: string): boolean {
    return error.includes('Invalid type');
  }

  isNestedError(error: string): boolean {
    return error.includes('missing field') && this.lastPropertyError === this.getPropertyFromError(error);
  }

  isPropertyError(error: string): boolean {
    return error.includes('missing field');
  }

  isExecutedError(error: string): boolean {
    return error.includes('length');
  }
}

export default ExecuteSchemaService;
