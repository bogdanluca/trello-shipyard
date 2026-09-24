import type { TrelloCard, TrelloList } from "./types";

const API = "https://api.trello.com/1";

export async function listBoardLists(
  key: string,
  token: string,
  boardId: string
): Promise<TrelloList[]> {
  const response = await trelloFetch(
    `/boards/${boardId}/lists`,
    key,
    token,
    { fields: "name" }
  );
  if (!response.ok) {
    throw new Error(`Trello ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as TrelloList[];
}

export async function listBoardCards(
  key: string,
  token: string,
  boardId: string,
  lists: TrelloList[]
): Promise<TrelloCard[]> {
  const response = await trelloFetch(
    `/boards/${boardId}/cards`,
    key,
    token,
    { fields: "name,desc,idList,url,shortLink", filter: "open" }
  );
  if (!response.ok) {
    throw new Error(`Trello ${response.status}: ${await response.text()}`);
  }
  const listNames = new Map(lists.map((list) => [list.id, list.name]));
  const cards = (await response.json()) as Array<{
    id: string;
    name: string;
    desc: string;
    idList: string;
    url: string;
    shortLink: string;
  }>;
  return cards.map((card) => ({
    ...card,
    listName: listNames.get(card.idList) ?? "Unknown",
  }));
}

export async function moveCardToList(
  key: string,
  token: string,
  cardId: string,
  listId: string
) {
  const response = await trelloFetch(`/cards/${cardId}`, key, token, {
    idList: listId,
  }, "PUT");
  if (!response.ok) {
    throw new Error(
      `Trello ${response.status} moving card ${cardId}: ${await response.text()}`
    );
  }
}

export function findDoneList(lists: TrelloList[], preferredName: string) {
  const wanted = normalizeListName(preferredName);
  return (
    lists.find((list) => normalizeListName(list.name) === wanted) ??
    lists.find((list) =>
      ["done", "complete", "completed", "closed"].includes(
        normalizeListName(list.name)
      )
    )
  );
}

export async function checkTrello(
  key: string,
  token: string,
  boardId: string
): Promise<string> {
  if (!key || !token) throw new Error("Add a Trello API key and token.");
  if (!boardId) throw new Error("Add a Trello board id.");
  const response = await trelloFetch(`/boards/${boardId}`, key, token, {
    fields: "name",
  });
  if (!response.ok) {
    throw new Error(`Trello ${response.status}: ${await response.text()}`);
  }
  const board = (await response.json()) as { name: string };
  return `Connected to board “${board.name}”`;
}

function normalizeListName(name: string) {
  return name.trim().toLowerCase();
}

function trelloFetch(
  path: string,
  key: string,
  token: string,
  extra: Record<string, string> = {},
  method = "GET"
) {
  const params = new URLSearchParams({ key, token, ...extra });
  return fetch(`${API}${path}?${params.toString()}`, {
    method,
    cache: "no-store",
  });
}
