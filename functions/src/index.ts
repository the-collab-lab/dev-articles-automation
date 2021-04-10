import * as functions from "firebase-functions";
import axios from "axios";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Airtable = require("airtable");

type Article = {
    published_timestamp: string,
    type_of: string,
    id: number,
    user: {
        name: string,
        username: string,
        profile_image_90: string
    }
}

type User = {
    username: string
}

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// This checks if the article's publish date is within one hour of the current date
const lastHour = (article: Article): boolean => {
  const articleDate = new Date(article.published_timestamp);
  const dateDifference = (new Date()).getTime() - articleDate.getTime();

  // Converts timestamp from milliseconds to hours
  return dateDifference / 1000 / 60 / 60 < 1;
};

const articlesOnly = (article: Article): boolean => article.type_of === "article";

const api = "https://dev.to/api"; // Limit for dev.to is 3 requests per second
const base = new Airtable({apiKey: functions.config().airtable.key}).base(functions.config().airtable.base);

export const getArticles = functions.https.onRequest(async (request, response) => {
  try {
    const {data: orgArticles}: {data: Article[]} = await axios.get(`${api}/organizations/the-collab-lab/articles`);
    const newOrgArticles = orgArticles.filter(lastHour).filter(articlesOnly);

    const {data: users}: {data: User[]} = await axios.get(`${api}/organizations/the-collab-lab/users?per_page=1000`);
    let allNewUserArticles: Article[] = [];

    const fetchUser = async ({username}: User) => {
      const {data: userArticles}: {data: Article[]} = await axios.get(`${api}/articles/latest?username=${username}`);

      const newUserArticles = userArticles.filter(lastHour).filter(articlesOnly).filter((article) => (
        // Filter out the articles that are already included in the organization pull
        !newOrgArticles.some((orgArticle) => article.id === orgArticle.id)
      ));

      functions.logger.info(`Articles for: ${username} (${newUserArticles.length})`, newUserArticles);

      allNewUserArticles = [...allNewUserArticles, ...newUserArticles];
    };

    const delayFetchingUser = async (user: User, index: number) => {
      await delay(1200 * index);
      await fetchUser(user);
    };

    // This gets all the other members that are being followed from Airtable and fetches their posts as well.
    let customFollowing: User[] = [];

    await new Promise((resolve) => {
      base("Following").select({view: "Grid view"}).eachPage((records: any[], fetchNextPage: () => void) => {
        customFollowing = records.map((record): User => ({
          username: record.get("Username"),
        }));
        fetchNextPage();
      }, (error: string) => {
        if (error) functions.logger.error(error);
        resolve();
      });
    });

    await Promise.all(users.map(delayFetchingUser));
    await Promise.all(customFollowing.map(delayFetchingUser));

    const allNewArticles = [...newOrgArticles, ...allNewUserArticles];

    functions.logger.info("Organization articles found:", newOrgArticles);
    functions.logger.info("Number of organization articles found:", newOrgArticles.length);
    functions.logger.info("Member articles found:", allNewUserArticles);
    functions.logger.info("Number of member articles found:", allNewUserArticles.length);
    functions.logger.info("Number of new articles found:", allNewArticles.length);

    functions.logger.info("Triggering Zapier Webhook:", functions.config().zapier.webhook);
    await axios.post(functions.config().zapier.webhook, {data: allNewArticles});

    response.json({data: allNewArticles});
  } catch (e) {
    functions.logger.error(e);
    response.status(400).send("Error while fetching data from DEV posts.");
  }
});
