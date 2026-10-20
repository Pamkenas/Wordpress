export interface WordPressPlugin {
  plugin: string;
  name: string;
  status: string;
  version: string;
  update?: string;
}

export class WordPressClient {
  private readonly baseUrl: string;
  private readonly authorization: string;

  constructor(baseUrl: string, username: string, applicationPassword: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");

    const credentials = Buffer.from(
      `${username}:${applicationPassword.replace(/\s+/g, "")}`,
    ).toString("base64");

    this.authorization = `Basic ${credentials}`;
  }

  async getPlugins(): Promise<WordPressPlugin[]> {
    const response = await fetch(`${this.baseUrl}/wp-json/wp/v2/plugins`, {
      headers: {
        Authorization: this.authorization,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(
        `WordPress API error: HTTP ${response.status} ${response.statusText}`,
      );
    }

    const data: unknown = await response.json();

    if (!Array.isArray(data)) {
      throw new Error("Unexpected plugin API response");
    }

    return data as WordPressPlugin[];
  }
}
