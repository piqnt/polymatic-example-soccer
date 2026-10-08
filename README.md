# Soccer Game - Polymatic Example

Multiplayer soccer, implemented using:
- [Polymatic](https://github.com/piqnt/polymatic) framework
- [Socket.io](https://socket.io/)
- [Planck.js](https://github.com/piqnt/planck.js) physics engine
- [Pixi.js](https://pixijs.com/) rendering engine

[Play Live Demo](https://soccer.piqnt.com/)

### Gameplay

Two teams take turns. Drag one of your players and release to shoot it, like a slingshot, and push the ball into the other team's goal.

- The team on turn is marked with rings, and the turn passes once everything has stopped.
- After a goal both teams go back to formation, and the team that conceded kicks off.
- The first team to score 3 goals wins.

The game starts against the computer, which plays blue; Play Computer starts a new one. Two Players is for two players taking turns on one device. Create Room starts an online game and shows a room id for the other player to enter with Join Room. Anyone joining after the first two watches.

### How to run the code

To run or build the source code in this repository you need to have node.js/npm installed.

Install this project dependencies:

```sh
npm install
```

To run the game server and the client locally:

```sh
npm run dev
```

This will print out the url where you can open the project. Two browser tabs can play each other in a room.

To build the client, which also works as a static site without the server:

```sh
npm run build
```

In production first build the client, then start the server:

```sh
npm run build
npm start
```
