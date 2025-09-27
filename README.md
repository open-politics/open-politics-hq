# 🌐 Open Politics HQ

> **Open source intelligence platform for 21st century research and analysis**

---
**Open Source Political Intelligence - What is that?** @ CCCB Datengarten  
[🎥 Watch Presentation](https://media.ccc.de/v/dg-111)

<div align="center">
  <img src=".github/assets/images/exactly.png" alt="Open Politics HQ Platform" width="600">
</div>

Why? 

 The modern information landscape is a (see up) battlefield across thousands of documents, sources, and events. Reading and sorting everything is impossible. Conducting research with creative yet reliable methods is difficult.

Our approach?

Combining the qualitative with the quantitative. 

Design the question in natural language, the most profound programming language with the most flexible structure that is out there. This allows experts from many domains (journalists, researchers, NGOs, etc.) to work on the "lenses" that are used to extract the information from the content.

We apply these lenses methodically to our data stored in our [information spaces](https://docs.open-politics.org/information-spaces).


- **[Webapp](https://open-politics.org)**
- **[Documentation](https://docs.open-politics.org)** for user guides & tutorials
  

### Usage

### Hosted Webapp
1. Visit [open-politics.org](https://open-politics.org/webpages/register) 


### Self-Hosted with Docker
1. Clone the repository and prepare the environment:
```bash
git clone https://github.com/open-politics/open-politics-hq.git
cd open-politics-hq
bash prepare.sh
cp .env.example .env
```

Log in with the 
```bash
FIRST_SUPERUSER=app_user
FIRST_SUPERUSER_PASSWORD=app_user_password
```
set in the .env file.


## Contact
engage@open-politics.org


## License
AGPLv3 licensed - see [LICENSE](LICENSE)
