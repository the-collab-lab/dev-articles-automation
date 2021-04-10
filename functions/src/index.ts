import * as functions from "firebase-functions";
import axios from "axios";

type Article = {
    // eslint-disable-next-line camelcase
    published_timestamp: string
    id: number,
    user: {
        name: string,
        username: string,
        // eslint-disable-next-line camelcase
        profile_image_90: string
    }
}

type User = {
    username: string
}

export const getArticles = functions.https.onRequest(async (request, response) => {
  const api = "https://dev.to/api";

  const lastHour = (article: Article): boolean => {
    // This checks if the article's publish date is within one hour of the current date

    const articleDate = new Date(article.published_timestamp);
    const dateDifference = (new Date()).getTime() - articleDate.getTime();

    // Converts timestamp from milliseconds to hours
    // @todo change 1000 hours to compare to 1 hour
    return dateDifference / 1000 / 60 / 60 < 1000;
  };

  try {
    const {data: orgArticles}: {data: Article[]} = await axios.get(`${api}/organizations/the-collab-lab/articles`);
    const newOrgArticles = orgArticles.filter(lastHour);

    const {data: users}: {data: User[]} = await axios.get(`${api}/organizations/the-collab-lab/users?per_page=1000`);
    let allNewUserArticles: Article[] = [];

    const fetchUser = async (user: User) => {
      const {data: userArticles}: {data: Article[]} = await axios.get(`${api}/articles/latest?username=${user.username}`);

      const newUserArticles = userArticles.filter(lastHour).filter((article) => (
        // Filter out the articles that are already included in the organization pull
        !newOrgArticles.some((orgArticle) => article.id === orgArticle.id)
      ));

      functions.logger.info(`Articles for: ${user.username} (${newUserArticles.length})`, newUserArticles);

      allNewUserArticles = [...allNewUserArticles, ...newUserArticles];
    };

    const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

    const userPromises = users.map(async (user, index) => {
      // Stagger fetch request, limit for dev.to is 3 requests per second
      await delay(1500 * index);
      await fetchUser(user);
    });
    await Promise.all(userPromises);

    const allNewArticles = [...newOrgArticles, ...allNewUserArticles];
    const allNewArticlesMapped = allNewArticles.map((article) => ({
      ...article,
      author: article.user.name,
      username: article.user.username,
      profile_image_90: article.user.profile_image_90,
    }));

    functions.logger.info("Organization articles found:", newOrgArticles);
    functions.logger.info("Number of organization articles found:", newOrgArticles.length);
    functions.logger.info("Member articles found:", allNewUserArticles);
    functions.logger.info("Number of member articles found:", allNewUserArticles.length);
    functions.logger.info("Number of new articles found:", allNewArticlesMapped.length);
    response.json({data: allNewArticlesMapped});
  } catch (e) {
    functions.logger.error(e);
    response.status(400).send("Error while fetching data from DEV posts.");
  }
});
