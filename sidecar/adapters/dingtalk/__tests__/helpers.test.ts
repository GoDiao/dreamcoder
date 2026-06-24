import { describe, expect, it } from 'bun:test'
import {
  extractDingTalkAttachments,
  extractDingTalkText,
  getDingTalkChatId,
  getDingTalkSenderId,
  isDingTalkDirectMessage,
  parseDingTalkPayload,
} from '../helpers.js'

describe('DingTalk helpers', () => {
  it('parses robot payload JSON safely', () => {
    expect(parseDingTalkPayload('{"msgtype":"text"}')?.msgtype).toBe('text')
    expect(parseDingTalkPayload('not-json')).toBeNull()
  })

  it('extracts sender and chat ids for direct messages', () => {
    const data = {
      conversationType: '1',
      senderStaffId: 'staff-1',
      conversationId: 'cid-1',
    }

    expect(isDingTalkDirectMessage(data)).toBe(true)
    expect(getDingTalkSenderId(data)).toBe('staff-1')
    expect(getDingTalkChatId(data)).toBe('dingtalk:dm:staff-1')
  })

  it('extracts text from common DingTalk content shapes', () => {
    expect(extractDingTalkText({ text: { content: ' hello ' } })).toBe('hello')
    expect(extractDingTalkText({ content: '{"text":"from content"}' })).toBe('from content')
    expect(extractDingTalkText({
      content: {
        richText: [
          { text: 'hello' },
          { text: ' world' },
        ],
      },
    })).toBe('hello world')
  })

  it('extracts image and file attachment candidates', () => {
    expect(extractDingTalkAttachments({
      msgtype: 'picture',
      content: { pictureUrl: 'https://example.com/a.jpg', downloadCode: 'pic-code' },
    })).toEqual([{ kind: 'image', url: 'https://example.com/a.jpg', downloadCode: 'pic-code' }])

    expect(extractDingTalkAttachments({
      msgtype: 'file',
      content: '{"fileName":"report.pdf","downloadCode":"file-code"}',
    })).toEqual([{ kind: 'file', downloadCode: 'file-code', fileName: 'report.pdf' }])

    expect(extractDingTalkAttachments({
      msgtype: 'richText',
      content: { richText: [{ text: 'hi' }, { type: 'picture', downloadCode: 'rich-pic' }] },
    })).toEqual([{ kind: 'image', url: undefined, downloadCode: 'rich-pic' }])
  })
})
